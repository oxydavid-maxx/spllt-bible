import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { runtimeConfig } from '../../src/config/runtime';
import { ProgressCard } from '../../src/ui/ProgressCard';
import { theme } from '../../src/ui/Theme';
import { fixtureProfile } from '../../src/ui/fixtureProfile';
import { openQingmuRepository } from '../../src/storage/mobileDatabase';
import { createApiClient, type ProgressSnapshot } from '../../src/services/apiClient';
import { buildProgressDisplay } from '../../src/ui/progressModel';
import { ReadingDateNavigator } from '../../src/ui/ReadingDateNavigator';
import { setSelectedReadingDate, useReadingSession } from '../../src/ui/readingSession';
import { isCurrentAuthSession, useAuthSnapshot } from '../../src/services/authSession';

export default function ProgressScreen() {
  const { selectedDate, period, previousDate, nextDate } = useReadingSession();
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const memberId = session?.memberId ?? (process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true' ? fixtureProfile.memberId : null);
  const [local, setLocal] = useState(() => {
    if (!memberId) return undefined;
    try {
      return openQingmuRepository().get({ memberId, planId: 'church-2026-09', taskDate: selectedDate });
    } catch {
      return undefined;
    }
  });
  const [remoteState, setRemoteState] = useState<{ memberId: string; sessionToken: string; snapshot: ProgressSnapshot } | null>(null);
  useEffect(() => {
    let active = true;
    const requestSession = session;
    setRemoteState(null);
    void (async () => {
      const token = requestSession?.sessionToken;
      const activeMemberId = memberId;
      if (!token || !activeMemberId) {
        return;
      }
      const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
      const api = createApiClient({ baseUrl: config.apiBaseUrl, token, memberId: activeMemberId });
      const snapshot = await api.getProgress(selectedDate, period);
      if (active && snapshot && isCurrentAuthSession(requestSession)) setRemoteState({ memberId: activeMemberId, sessionToken: token, snapshot });
    })().catch(() => { if (active && isCurrentAuthSession(requestSession)) setRemoteState(null); });
    return () => { active = false; };
  }, [auth.status, session?.sessionToken, memberId, selectedDate, period.start, period.end]);
  useFocusEffect(useCallback(() => {
    if (!memberId) {
      setLocal(undefined);
      return undefined;
    }
    try {
      setLocal(openQingmuRepository().get({ memberId, planId: 'church-2026-09', taskDate: selectedDate }));
    } catch {
      setLocal(undefined);
    }
    return undefined;
  }, [memberId, selectedDate]));
  const remote = remoteState && session && remoteState.memberId === session.memberId && remoteState.sessionToken === session.sessionToken ? remoteState.snapshot : null;
  const visibleLocal = local?.memberId === memberId ? local : undefined;
  const personalStatus = remote?.personal?.status ?? visibleLocal?.status ?? 'UNREPORTED';
  const display = buildProgressDisplay(personalStatus, remote);
  const members = remote?.members ?? null;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>我的進度</Text>
      <ReadingDateNavigator date={selectedDate} previousDate={previousDate} nextDate={nextDate} onSelect={setSelectedReadingDate} />
      <ProgressCard {...display} />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>小組今日回報</Text>
        {members ? members.map((member) => <View key={member.id} style={styles.memberRow}><Text style={styles.memberName}>{member.label}</Text><Text style={styles.status}>{member.status === 'COMPLETED' ? '已完成' : member.status === 'NOT_COMPLETED' ? '未完成' : '未回報'}</Text></View>) : <Text style={styles.note}>小組摘要等候已驗證連線；本機只顯示自己的保存狀態，不猜測其他人。</Text>}
      </View>
      <Text style={styles.note}>目前自己的狀態：{personalStatus === 'COMPLETED' ? '已完成' : personalStatus === 'NOT_COMPLETED' ? '未完成' : '未回報'}。積分只在教會政策啟用後計算；本頁不提供兌獎商店。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.background, flexGrow: 1 },
  title: { color: theme.colors.ink, fontSize: theme.type.display.size, lineHeight: theme.type.display.line, fontWeight: '800' },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.xs },
  cardTitle: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '700' },
  memberRow: { minHeight: theme.control.tapCompact, borderTopColor: theme.colors.border, borderTopWidth: theme.control.hairline, alignItems: 'center', paddingVertical: theme.spacing.xs, flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm },
  memberName: { color: theme.colors.ink, fontSize: theme.type.body.size },
  status: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
