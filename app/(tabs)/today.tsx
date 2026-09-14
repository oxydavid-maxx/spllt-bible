import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { randomUUID } from 'expo-crypto';
import { runtimeConfig } from '../../src/config/runtime';
import { type CompletionRecord } from '../../src/domain/completion';
import { createApiClient } from '../../src/services/apiClient';
import { openQingmuRepository } from '../../src/storage/mobileDatabase';
import { fixtureProfile } from '../../src/ui/fixtureProfile';
import { ReadingTaskCard } from '../../src/ui/ReadingTaskCard';
import { StatusCard } from '../../src/ui/StatusCard';
import { buildFixtureModels } from '../../src/ui/routes';
import { theme } from '../../src/ui/Theme';
import { ReadingDateNavigator } from '../../src/ui/ReadingDateNavigator';
import { mergeReadingPlan, useReadingSession, setSelectedReadingDate } from '../../src/ui/readingSession';
import { isCurrentAuthSession, useAuthSnapshot } from '../../src/services/authSession';
import * as SecureStore from 'expo-secure-store';
import { createReminderScheduler } from '../../src/services/reminderScheduler';
import { syncReadingReminderForCompletion } from '../../src/services/reminderCompletion';
import { TodayAuthGate } from '../../src/ui/TodayAuthGate';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { useOutboxRecovery } from '../../src/services/useOutboxRecovery';
import { isWithinCompletionWindow, taipeiDate } from '../../src/domain/gamificationV1';
import { BibleContentPreloadHome } from '../../src/ui/BibleContentPreloadHome';
import { createNativeReaderPreferencesStore } from '../../src/services/nativeReaderPreferences';
import { useReaderPreferences } from '../../src/ui/useReaderPreferences';

export default function TodayScreen() {
  const { selectedDate, planId, day, period, previousDate, nextDate } = useReadingSession();
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const memberId = session?.memberId ?? (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' ? fixtureProfile.memberId : null);
  const [readerPreferencesStore] = useState(createNativeReaderPreferencesStore);
  const readerPreferences = useReaderPreferences(memberId, readerPreferencesStore);
  const selectedVersionId = readerPreferences.ready ? readerPreferences.preferences.versionId : null;
  const model = buildFixtureModels(selectedDate);
  const [reminderScheduler] = useState(() => createReminderScheduler());
  const repositoryRef = useRef<ReturnType<typeof openQingmuRepository> | null>(null);
  const [record, setRecord] = useState<CompletionRecord>(() => {
    const initialMemberId = memberId ?? 'signed-out';
    if (!memberId) return { memberId: initialMemberId, planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
    try {
      const repository = openQingmuRepository();
      repositoryRef.current = repository;
      return repository.get({ memberId, planId, taskDate: selectedDate }) ?? {
        memberId,
        planId,
        taskDate: selectedDate,
        status: 'UNREPORTED',
        revision: 0,
        syncStatus: 'CONFIRMED',
      };
    } catch {
      return {
        memberId: initialMemberId,
        planId,
        taskDate: selectedDate,
        status: 'UNREPORTED',
        revision: 0,
        syncStatus: 'CONFIRMED',
      };
    }
  });
  useFocusEffect(useCallback(() => {
    let active = true;
    if (!memberId) {
      setRecord({ memberId: 'signed-out', planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' });
      return () => { active = false; };
    }
    const repository = repositoryRef.current ?? openQingmuRepository();
    repositoryRef.current = repository;
    setRecord(repository.get({ memberId, planId, taskDate: selectedDate }) ?? {
      memberId, planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED',
    });
    const focusSession = session;
    const focusClient = clientRef.current;
    if (focusClient) {
      void repository.flush((command) => focusClient.saveCompletion(command), memberId).then(async () => {
        const recovered = repository.get({ memberId, planId, taskDate: selectedDate });
        if (active && recovered && isCurrentAuthSession(focusSession)) setRecord(recovered);
      }).catch(() => { if (active && isCurrentAuthSession(focusSession)) setSyncError(true); });
    }
    return () => { active = false; };
  }, [auth.status, session?.sessionToken, memberId, planId, selectedDate, period.start, period.end]));
  const [syncError, setSyncError] = useState(false);
  const authToken = session?.sessionToken ?? (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' ? process.env.EXPO_PUBLIC_QINGMU_DEV_TOKEN?.trim() ?? null : null);
  const clientRef = useRef<ReturnType<typeof createApiClient> | null>(null);
  useEffect(() => {
    clientRef.current = null;
    if (!memberId) {
      setRecord({ memberId: 'signed-out', planId, taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' });
      setSyncError(false);
    }
  }, [memberId, selectedDate]);
  useEffect(() => {
    let active = true;
    const requestSession = session;
    void (async () => {
      try {
        const token = authToken;
        const activeMemberId = memberId;
        if (!token || !activeMemberId) return;
        const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
        const client = createApiClient({ baseUrl: config.apiBaseUrl, token, memberId: activeMemberId });
        clientRef.current = client;
        if (repositoryRef.current) {
          await repositoryRef.current.flush((command) => client.saveCompletion(command), activeMemberId);
          const recovered = repositoryRef.current.get({ memberId: activeMemberId, planId, taskDate: selectedDate });
          if (active && recovered && isCurrentAuthSession(requestSession)) setRecord(recovered);
        }
        const scheduleFrom = shiftDate(selectedDate, -31);
        const scheduleTo = shiftDate(selectedDate, 30);
        const schedule = typeof client.getReadingDays === 'function' ? await client.getReadingDays(scheduleFrom, scheduleTo) : null;
        if (active && schedule && isCurrentAuthSession(requestSession) && schedule.days.length > 0) {
          const days = schedule.days.map((item) => ({ date: item.taskDate, planId: item.planId, sourceRows: item.references, references: item.references }));
          mergeReadingPlan({ planId: schedule.days[0].planId, timezone: schedule.timezone, days, dates: days.map((item) => item.date), uniqueReferences: [...new Set(days.flatMap((item) => item.references))] });
        }
      } catch {
        if (active && isCurrentAuthSession(requestSession)) setSyncError(true);
      }
    })();
    return () => { active = false; };
  }, [auth.status, authToken, memberId, planId, selectedDate, period.start, period.end]);
  useOutboxRecovery({
    memberId,
    sessionToken: session?.sessionToken ?? null,
    planId,
    taskDate: selectedDate,
    getRepository: () => repositoryRef.current,
    getClient: () => clientRef.current,
    getSession: () => session,
    isCurrentAuthSession,
    onRecovered: () => {
      const repository = repositoryRef.current;
      const recoverySession = session;
      if (!repository || !memberId || !isCurrentAuthSession(recoverySession)) return;
      const recovered = repository.get({ memberId, planId, taskDate: selectedDate });
      if (!recovered) return;
      setRecord(recovered);
      if (recovered.syncStatus === 'CONFIRMED') {
        setSyncError(false);
      } else if (recovered.syncStatus === 'SAVE_FAILED') {
        setSyncError(true);
      }
    },
  });
  const save = async (desiredStatus: 'COMPLETED' | 'NOT_COMPLETED') => {
    const repository = repositoryRef.current;
    const actionSession = session;
    if (!repository || !memberId || !isCurrentAuthSession(actionSession)) return;
    const visibleRecord = record.memberId === memberId ? record : { memberId, planId, taskDate: selectedDate, status: 'UNREPORTED' as const, revision: 0, syncStatus: 'CONFIRMED' as const };
    const current = repository.get({ memberId, planId, taskDate: selectedDate }) ?? visibleRecord;
    const next = repository.saveCompletion({
      memberId: visibleRecord.memberId,
      planId: visibleRecord.planId,
      taskDate: selectedDate,
      desiredStatus,
      operationId: randomUUID(),
      expectedRevision: current.revision,
      syncStatus: 'PENDING_SAVE',
    });
    void (async () => { if (isCurrentAuthSession(actionSession)) await syncReadingReminderForCompletion({ memberId, planId, taskDate: selectedDate, status: desiredStatus, scheduler: reminderScheduler, store: SecureStore }); })();
    setRecord(next);
    setSyncError(false);
    if (clientRef.current) {
      try {
        const client = clientRef.current;
        if (!client || !isCurrentAuthSession(actionSession)) return;
        const results = await repository.flush((command) => client.saveCompletion(command), memberId);
        const confirmed = repository.get(next);
        if (confirmed && isCurrentAuthSession(actionSession)) {
          setRecord(confirmed);
          setSyncError(confirmed.syncStatus !== 'CONFIRMED');
        } else {
          const last = results.at(-1);
          if (last && !last.ok) setSyncError(true);
        }
      } catch {
        if (isCurrentAuthSession(actionSession)) setSyncError(true);
      }
    }
  };
  const visibleRecord = record.memberId === (memberId ?? 'signed-out') ? record : { memberId: memberId ?? 'signed-out', planId, taskDate: selectedDate, status: 'UNREPORTED' as const, revision: 0, syncStatus: 'CONFIRMED' as const };
  const canComplete = isWithinCompletionWindow(selectedDate, taipeiDate(new Date()));
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <View style={styles.dateNavigator}>
          <ReadingDateNavigator date={selectedDate} previousDate={previousDate} nextDate={nextDate} onSelect={setSelectedReadingDate} />
        </View>
        <AccountEntryButton />
      </View>
      <BibleContentPreloadHome
        enabled={Boolean(memberId && day && readerPreferences.ready && selectedVersionId !== null && process.env.EXPO_PUBLIC_YOUVERSION_APP_KEY?.trim() && process.env.EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE === 'true')}
        appKey={process.env.EXPO_PUBLIC_YOUVERSION_APP_KEY ?? null}
        apiBaseUrl={process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL}
        versionId={selectedVersionId}
        references={day?.references ?? model.today.references}
        generationKey={`${memberId ?? 'signed-out'}:${selectedDate}:${selectedVersionId ?? 'pending'}:${(day?.references ?? model.today.references).join('|')}`}
      />
      {day ? <ReadingTaskCard date={selectedDate} references={day.references} completed={visibleRecord.status === 'COMPLETED'} canComplete={canComplete} syncStatus={visibleRecord.syncStatus} onOpenReader={() => router.push('/reader')} onComplete={memberId ? () => { void save('COMPLETED'); } : undefined} onUndo={memberId ? () => { void save('NOT_COMPLETED'); } : undefined} /> : <StatusCard title="今天沒有排定讀經" body="讀經表沒有這一天的內容；不會自行補上任務。" tone="info" />}
      {auth.status !== 'signed-in' && <TodayAuthGate baseUrl={runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl} />}
      {syncError && <Text style={styles.note}>同步遇到問題；你仍可繼續使用，下一次連線會重試相同操作。</Text>}
    </ScrollView>
    </SafeAreaView>
  );
}

function shiftDate(date: string, offsetDays: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  dateNavigator: { flex: 1, minWidth: 0 },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
