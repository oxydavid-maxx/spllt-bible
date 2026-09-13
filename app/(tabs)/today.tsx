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
import type { ProgressSnapshot } from '../../src/services/apiClient';
import { openQingmuRepository } from '../../src/storage/mobileDatabase';
import { fixtureProfile } from '../../src/ui/fixtureProfile';
import { ReadingTaskCard } from '../../src/ui/ReadingTaskCard';
import { StatusCard } from '../../src/ui/StatusCard';
import { ProgressCard } from '../../src/ui/ProgressCard';
import { buildProgressDisplay } from '../../src/ui/progressModel';
import { buildFixtureModels } from '../../src/ui/routes';
import { theme } from '../../src/ui/Theme';
import { ReadingDateNavigator } from '../../src/ui/ReadingDateNavigator';
import { useReadingSession, setSelectedReadingDate } from '../../src/ui/readingSession';
import { isCurrentAuthSession, useAuthSnapshot } from '../../src/services/authSession';
import * as SecureStore from 'expo-secure-store';
import { createReminderScheduler } from '../../src/services/reminderScheduler';
import { syncReadingReminderForCompletion } from '../../src/services/reminderCompletion';
import { TodayAuthGate } from '../../src/ui/TodayAuthGate';
import { AccountEntryButton } from '../../src/ui/AccountEntryButton';
import { useOutboxRecovery } from '../../src/services/useOutboxRecovery';

export default function TodayScreen() {
  const { selectedDate, day, period, previousDate, nextDate } = useReadingSession();
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const memberId = session?.memberId ?? (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' ? fixtureProfile.memberId : null);
  const model = buildFixtureModels(selectedDate);
  const [reminderScheduler] = useState(() => createReminderScheduler());
  const repositoryRef = useRef<ReturnType<typeof openQingmuRepository> | null>(null);
  const [record, setRecord] = useState<CompletionRecord>(() => {
    const initialMemberId = memberId ?? 'signed-out';
    if (!memberId) return { memberId: initialMemberId, planId: 'church-2026-09', taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
    try {
      const repository = openQingmuRepository();
      repositoryRef.current = repository;
      return repository.get({ memberId, planId: 'church-2026-09', taskDate: selectedDate }) ?? {
        memberId,
        planId: 'church-2026-09',
        taskDate: selectedDate,
        status: 'UNREPORTED',
        revision: 0,
        syncStatus: 'CONFIRMED',
      };
    } catch {
      return {
        memberId: initialMemberId,
        planId: 'church-2026-09',
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
      setRecord({ memberId: 'signed-out', planId: 'church-2026-09', taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' });
      return () => { active = false; };
    }
    const repository = repositoryRef.current ?? openQingmuRepository();
    repositoryRef.current = repository;
    setRecord(repository.get({ memberId, planId: 'church-2026-09', taskDate: selectedDate }) ?? {
      memberId, planId: 'church-2026-09', taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED',
    });
    const focusSession = session;
    const focusClient = clientRef.current;
    if (focusClient) {
      void repository.flush((command) => focusClient.saveCompletion(command), memberId).then(async () => {
        const recovered = repository.get({ memberId, planId: 'church-2026-09', taskDate: selectedDate });
        if (active && recovered && isCurrentAuthSession(focusSession)) setRecord(recovered);
        const snapshot = await focusClient.getProgress(selectedDate, period);
        if (active && snapshot && isCurrentAuthSession(focusSession)) setRemoteProgressState({ memberId, sessionToken: focusSession?.sessionToken ?? '', snapshot });
      }).catch(() => { if (active && isCurrentAuthSession(focusSession)) setSyncError(true); });
    }
    return () => { active = false; };
  }, [auth.status, session?.sessionToken, memberId, selectedDate, period.start, period.end]));
  const [syncError, setSyncError] = useState(false);
  const authToken = session?.sessionToken ?? (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' ? process.env.EXPO_PUBLIC_QINGMU_DEV_TOKEN?.trim() ?? null : null);
  const [remoteProgressState, setRemoteProgressState] = useState<{ memberId: string; sessionToken: string; snapshot: ProgressSnapshot } | null>(null);
  const clientRef = useRef<ReturnType<typeof createApiClient> | null>(null);
  useEffect(() => {
    clientRef.current = null;
    if (!memberId) {
      setRemoteProgressState(null);
      setRecord({ memberId: 'signed-out', planId: 'church-2026-09', taskDate: selectedDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' });
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
        if (active) setRemoteProgressState(null);
        const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
        const client = createApiClient({ baseUrl: config.apiBaseUrl, token, memberId: activeMemberId });
        clientRef.current = client;
        if (repositoryRef.current) {
          await repositoryRef.current.flush((command) => client.saveCompletion(command), activeMemberId);
          const recovered = repositoryRef.current.get({ memberId: activeMemberId, planId: 'church-2026-09', taskDate: selectedDate });
          if (active && recovered && isCurrentAuthSession(requestSession)) setRecord(recovered);
        }
        const snapshot = await client.getProgress(selectedDate, period);
        if (active && snapshot && isCurrentAuthSession(requestSession)) setRemoteProgressState({ memberId: activeMemberId, sessionToken: token, snapshot });
      } catch {
        if (active && isCurrentAuthSession(requestSession)) setSyncError(true);
      }
    })();
    return () => { active = false; };
  }, [auth.status, authToken, memberId, selectedDate, period.start, period.end]);
  useOutboxRecovery({
    memberId,
    sessionToken: session?.sessionToken ?? null,
    planId: 'church-2026-09',
    taskDate: selectedDate,
    getRepository: () => repositoryRef.current,
    getClient: () => clientRef.current,
    getSession: () => session,
    isCurrentAuthSession,
    onRecovered: () => {
      const repository = repositoryRef.current;
      const recoverySession = session;
      if (!repository || !memberId || !isCurrentAuthSession(recoverySession)) return;
      const recovered = repository.get({ memberId, planId: 'church-2026-09', taskDate: selectedDate });
      if (!recovered) return;
      setRecord(recovered);
      if (recovered.syncStatus === 'CONFIRMED') {
        setSyncError(false);
        const client = clientRef.current;
        if (client) {
          void client.getProgress(selectedDate, period).then((snapshot) => {
            if (snapshot && isCurrentAuthSession(recoverySession)) {
              setRemoteProgressState({ memberId, sessionToken: recoverySession!.sessionToken, snapshot });
            }
          }).catch(() => { /* progress refresh is best-effort; the confirmed record already rendered */ });
        }
      } else if (recovered.syncStatus === 'SAVE_FAILED') {
        setSyncError(true);
      }
    },
  });
  const save = async (desiredStatus: 'COMPLETED' | 'NOT_COMPLETED') => {
    const repository = repositoryRef.current;
    const actionSession = session;
    if (!repository || !memberId || !isCurrentAuthSession(actionSession)) return;
    const visibleRecord = record.memberId === memberId ? record : { memberId, planId: 'church-2026-09', taskDate: selectedDate, status: 'UNREPORTED' as const, revision: 0, syncStatus: 'CONFIRMED' as const };
    const current = repository.get({ memberId, planId: 'church-2026-09', taskDate: selectedDate }) ?? visibleRecord;
    const next = repository.saveCompletion({
      memberId: visibleRecord.memberId,
      planId: visibleRecord.planId,
      taskDate: selectedDate,
      desiredStatus,
      operationId: randomUUID(),
      expectedRevision: current.revision,
      syncStatus: 'PENDING_SAVE',
    });
    void (async () => { if (isCurrentAuthSession(actionSession)) await syncReadingReminderForCompletion({ memberId, taskDate: selectedDate, status: desiredStatus, scheduler: reminderScheduler, store: SecureStore }); })();
    setRecord(next);
    setRemoteProgressState(null);
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
        const snapshot = await client.getProgress(selectedDate, period);
        if (snapshot && isCurrentAuthSession(actionSession)) setRemoteProgressState({ memberId, sessionToken: actionSession!.sessionToken, snapshot });
      } catch {
        if (isCurrentAuthSession(actionSession)) setSyncError(true);
      }
    }
  };
  const visibleRecord = record.memberId === (memberId ?? 'signed-out') ? record : { memberId: memberId ?? 'signed-out', planId: 'church-2026-09', taskDate: selectedDate, status: 'UNREPORTED' as const, revision: 0, syncStatus: 'CONFIRMED' as const };
  const remoteProgress = remoteProgressState && session && remoteProgressState.memberId === session.memberId && remoteProgressState.sessionToken === session.sessionToken ? remoteProgressState.snapshot : null;
  const goal = buildProgressDisplay(visibleRecord.status, remoteProgress);
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <View style={styles.dateNavigator}>
          <ReadingDateNavigator date={selectedDate} previousDate={previousDate} nextDate={nextDate} onSelect={setSelectedReadingDate} />
        </View>
        <AccountEntryButton />
      </View>
      {day ? <ReadingTaskCard date={selectedDate} references={model.today.references} completed={visibleRecord.status === 'COMPLETED'} syncStatus={visibleRecord.syncStatus} onOpenReader={() => router.push('/reader')} onComplete={memberId ? () => { void save('COMPLETED'); } : undefined} onUndo={memberId ? () => { void save('NOT_COMPLETED'); } : undefined} /> : <StatusCard title="今天沒有排定讀經" body="讀經表沒有這一天的內容；不會自行補上任務。" tone="info" />}
      <ProgressCard {...goal} />
      {auth.status !== 'signed-in' && <TodayAuthGate baseUrl={runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl} />}
      {syncError && <Text style={styles.note}>同步遇到問題；你仍可繼續使用，下一次連線會重試相同操作。</Text>}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  dateNavigator: { flex: 1, minWidth: 0 },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
