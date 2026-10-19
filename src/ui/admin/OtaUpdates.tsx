import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { runtimeConfig } from '../../config/runtime';
import { useAuthSnapshot } from '../../services/authSession';
import { createGamificationApiClient } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

/** Fire after rendering; a stalled/offline update service never owns the app's loading state. */
export async function checkOtaUpdateInBackground(): Promise<void> {
  try {
    // NEVER is reserved for the isolated native CI build. Read the installed binary's policy,
    // not OTA manifest metadata, so a CI export can never switch off a production installation.
    if (!Updates.isEnabled || Updates.checkAutomatically !== Updates.UpdatesCheckAutomaticallyValue.ON_ERROR_RECOVERY) return;
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable || result.isRollBackToEmbedded) await Updates.fetchUpdateAsync();
    // Deliberately no reloadAsync: downloaded assets apply on the next cold start, including while reading/audio plays.
  } catch {
    // The embedded/cached update remains usable; startup has already continued.
  }
}

let startupCheckStarted = false;
// Updates.channel is fixed at startup. Retain a successful selection across account-route remounts;
// the native override owns persistence across process restarts.
let channelSelection: { startedOn: string | null; preview: boolean } | null = null;
export function OtaUpdateCheck() {
  useEffect(() => {
    if (startupCheckStarted) return;
    startupCheckStarted = true;
    void checkOtaUpdateInBackground();
  }, []);
  return null;
}

/** Uses the same server capability as the existing administrator entry, scoped to the current session. */
export function AdminOtaUpdatesEntry() {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const sessionKey = session ? `${session.memberId}:${session.sessionToken}` : null;
  const [allowedFor, setAllowedFor] = useState<string | null>(null);
  const [preview, setPreview] = useState(() => channelSelection?.startedOn === Updates.channel ? channelSelection.preview : Updates.channel === 'preview');
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setAllowedFor(null);
    if (!session) return;
    let active = true;
    const client = createGamificationApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId });
    void client.getCapabilities().then((value) => { if (active && value.canViewAllScores) setAllowedFor(sessionKey); }).catch(() => undefined);
    return () => { active = false; };
  }, [sessionKey]);
  if (!sessionKey || allowedFor !== sessionKey) return null;

  const changeChannel = (enabled: boolean) => {
    try {
      Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': enabled ? 'preview' : 'production' });
      channelSelection = { startedOn: Updates.channel, preview: enabled };
      setPreview(enabled);
      setMessage('下次開啟時會在背景下載，再下一次開啟時套用。');
    } catch {
      setMessage('暫時無法切換，請稍後再試。');
    }
  };
  return <View style={styles.card}>
    <View style={styles.row}>
      <Text style={styles.title}>先收到測試版更新</Text>
      <Switch testID="ota-preview-switch" accessibilityLabel="先收到測試版更新" accessibilityHint="只給管理者：先拿到還沒發給大家的修正，驗收用。" value={preview} onValueChange={changeChannel} trackColor={{ true: theme.colors.primary }} />
    </View>
    <Text style={styles.note}>只給管理者：先拿到還沒發給大家的修正，驗收用。</Text>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing.md, gap: theme.spacing.xs, borderRadius: theme.radius.card, borderWidth: theme.control.hairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, minHeight: theme.control.tap },
  title: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
});
