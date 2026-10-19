import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { runtimeConfig } from '../../config/runtime';
import { useAuthSnapshot } from '../../services/authSession';
import { createGamificationApiClient } from '../../services/gamificationApiClient';
import { readViewerCapabilities, useViewerCapabilities } from '../../services/viewerCapabilities';
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
function startStartupCheck(): void {
  if (startupCheckStarted) return;
  startupCheckStarted = true;
  void checkOtaUpdateInBackground();
}

// Updates.channel is fixed at startup. Retain a successful selection across account-route remounts;
// the native override owns persistence across process restarts.
let channelSelection: { startedOn: string | null; preview: boolean } | null = null;
const selectionListeners = new Set<() => void>();
function subscribeSelection(listener: () => void): () => void { selectionListeners.add(listener); return () => { selectionListeners.delete(listener); }; }
function previewSelected(): boolean { return channelSelection?.startedOn === Updates.channel ? channelSelection.preview : Updates.channel === 'preview'; }
function selectChannel(preview: boolean): boolean {
  try {
    Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': preview ? 'preview' : 'production' });
  } catch {
    return false;
  }
  channelSelection = { startedOn: Updates.channel, preview };
  selectionListeners.forEach((listener) => listener());
  return true;
}
// The override is saved on the phone and outlives the session that set it, yet only an administrator sees
// the switch. Whoever else holds the phone (signed out, another member, a removed role) goes back to production.
function leavePreviewUnlessAdministrator(isAdministrator: boolean): void {
  if (!isAdministrator && previewSelected()) selectChannel(false);
}
export function OtaUpdateCheck() {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  // Same key as useViewerCapabilities, so a lookup the account page starts at the same time is one request.
  // The root layout is not a focused screen, so it uses the shared reader rather than the focus-driven hook.
  const viewerKey = session ? JSON.stringify([session.memberId, session.sessionToken, auth.epoch]) : null;
  useEffect(() => {
    // Production phones (everyone but an administrator testing preview) check at once, with no extra request.
    if (!previewSelected()) { startStartupCheck(); return; }
    // Decide who holds a preview phone before anything is downloaded from preview.
    if (auth.status === 'signed-out') { leavePreviewUnlessAdministrator(false); startStartupCheck(); return; }
    if (!session || !viewerKey) return; // Restoring or expired sign-in: wait for a definite member.
    let active = true;
    const client = createGamificationApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId });
    void readViewerCapabilities(viewerKey, () => client.getCapabilities()).then((value) => {
      if (!active) return;
      leavePreviewUnlessAdministrator(value.canViewAllScores);
      startStartupCheck();
    }).catch(() => undefined); // Role unconfirmed (offline/server error): keep the selection, skip this launch's preview check.
    return () => { active = false; };
  }, [auth.status, viewerKey]);
  return null;
}

/** One of the account page's administrator rows: the same shared lookup as its neighbours (#73). */
export function AdminOtaUpdatesEntry() {
  const capabilities = useViewerCapabilities();
  const preview = useSyncExternalStore(subscribeSelection, previewSelected, previewSelected);
  const [message, setMessage] = useState<string | null>(null);
  // A definite "not an administrator" (role removed, another member) also ends preview on this phone.
  useEffect(() => { if (capabilities) leavePreviewUnlessAdministrator(capabilities.canViewAllScores); }, [capabilities]);
  if (!capabilities?.canViewAllScores) return null;

  const changeChannel = (enabled: boolean) => {
    setMessage(selectChannel(enabled) ? '下次開啟時會在背景下載，再下一次開啟時套用。' : '暫時無法切換，請稍後再試。');
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
