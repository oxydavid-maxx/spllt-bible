import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { GroupCard } from '../../src/ui/GroupCard';
import { buildFixtureModels } from '../../src/ui/routes';
import { theme } from '../../src/ui/Theme';
import { isCurrentAuthSession, useAuthSnapshot } from '../../src/services/authSession';
import { runtimeConfig } from '../../src/config/runtime';
import { createApiClient, type GroupProfileSnapshot } from '../../src/services/apiClient';
import { buildGroupContextModel } from '../../src/ui/groupContext';
import { shouldClearOnFailedFetch, sessionKeyOf } from '../../src/ui/groupsRefreshPolicy';

export default function GroupsScreen() {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const fixture = process.env.EXPO_PUBLIC_QINGMU_FIXTURE === 'true';
  const model = fixture ? buildFixtureModels() : null;
  const [remoteState, setRemoteState] = useState<{ memberId: string; sessionToken: string; snapshot: GroupProfileSnapshot } | null>(null);
  const lastSessionKeyRef = useRef<string | null>(null);
  // Expo Router keeps tab screens mounted, so useFocusEffect (not a mount-only
  // effect) refetches whenever My RPG regains focus, catching server-side
  // meeting changes made while the tab was merely backgrounded.
  useFocusEffect(useCallback(() => {
    let active = true;
    const requestSession = session;
    const sessionKey = sessionKeyOf(requestSession);
    const isNewSession = lastSessionKeyRef.current !== sessionKey;
    lastSessionKeyRef.current = sessionKey;
    // Only a signed-in identity change clears the visible snapshot; a same-session
    // refetch on regained focus keeps showing the last good snapshot while it loads.
    if (isNewSession) setRemoteState(null);
    void (async () => {
      const token = requestSession?.sessionToken;
      const memberId = requestSession?.memberId;
      if (!token || !memberId) return;
      const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
      const profile = await createApiClient({ baseUrl: config.apiBaseUrl, token, memberId }).getGroups();
      if (active && profile && isCurrentAuthSession(requestSession)) setRemoteState({ memberId, sessionToken: token, snapshot: profile });
    })().catch(() => {
      if (!active || !isCurrentAuthSession(requestSession)) return;
      // A failed refetch on regained focus (e.g. offline) keeps the last good snapshot;
      // a genuinely first load for this session (no prior snapshot yet) still clears to empty.
      setRemoteState((previous) => (shouldClearOnFailedFetch(previous, requestSession) ? null : previous));
    });
    return () => { active = false; };
  }, [auth.status, session?.sessionToken, session?.memberId]));
  const remote = remoteState && session && remoteState.memberId === session.memberId && remoteState.sessionToken === session.sessionToken ? remoteState.snapshot : null;
  const remoteRpg = remote?.rpgs[0];
  const groups = remote
    ? { groupName: `${remote.groupName} / ${remoteRpg?.rpgName ?? 'RPG'}`, openChatUrl: remoteRpg?.openChatUrl ?? null, rpgUrl: null, callUrl: remoteRpg?.callUrl ?? null, callProvider: remoteRpg?.callProvider ?? null, callScope: remoteRpg?.callScope ?? null, linkStatus: remoteRpg?.linkStatus ?? 'PENDING_UI_VERIFICATION' as const }
    : model?.groups ?? { groupName: session ? '已登入，等待核准小組入口' : '請先登入查看小組', openChatUrl: null, rpgUrl: null, callUrl: null, callProvider: null, callScope: null, linkStatus: 'PENDING_UI_VERIFICATION' as const };
  const context = remote && remoteRpg
    ? buildGroupContextModel({
        groupName: remote.groupName,
        rpgName: remoteRpg.rpgName,
        callProvider: remoteRpg.callProvider,
        callUrl: remoteRpg.callUrl,
        openChatUrl: remoteRpg.openChatUrl,
        meeting: remoteRpg.meeting
          ? { title: remoteRpg.meeting.title, startsAt: remoteRpg.meeting.startsAt ?? '', timeZone: remoteRpg.meeting.timeZone, revision: remoteRpg.meeting.revision, status: remoteRpg.meeting.status }
          : null,
        roster: remoteRpg.roster,
      })
    : null;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>小組/RPG</Text>
      <Text style={styles.body}>{fixture ? '固定小組成員自己約；LINE社群入口尚待核對，現在提供一個標明為測試的Meet通話入口。' : '固定小組與RPG入口會在登入及同工核准歸屬後顯示；App不自行把成員加入陌生群組。'}</Text>
      <GroupCard {...groups} />
      {context && (
        <View accessibilityLabel="RPG聚會與組員資訊" style={styles.contextCard}>
          <Text style={styles.contextTitle}>{context.title}</Text>
          <Text style={styles.contextBody}>{context.meetingLabel}{context.meetingDate ? ` · ${context.meetingDate}` : ''}</Text>
          <Text style={styles.contextBody}>組員：{context.rosterLabels.length > 0 ? context.rosterLabels.join('、') : '尚未提供'}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.background, flexGrow: 1 },
  title: { color: theme.colors.ink, fontSize: theme.type.display.size, lineHeight: theme.type.display.line, fontWeight: '800' },
  body: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  contextCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.xs },
  contextTitle: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '700' },
  contextBody: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
