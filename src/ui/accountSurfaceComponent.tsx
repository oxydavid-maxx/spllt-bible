import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { clearAuthSession, clearAuthSessionIfCurrent, retryAuthProfile, useAuthSnapshot } from '../services/authSession';
import { createApiClient } from '../services/apiClient';
import { runtimeConfig } from '../config/runtime';
import { GoogleLoginCard } from './GoogleLoginCard';
import { appVersionLabel, buildAccountSurfaceModel } from './accountSurface';
import { theme } from './Theme';
import { ReminderSettings } from './ReminderSettings';
import { CongregationSetting } from './congregation/CongregationSetting';
import { getReminderRuntimeOwner, useReminderRuntimeSnapshot } from '../services/reminderRuntime';

/** `adminEntry`: the route hands in 全體 (管理), so this surface stays free of navigation. */
export function AccountSurface({ adminEntry }: { adminEntry?: ReactNode } = {}) {
  const auth = useAuthSnapshot();
  const session = auth.session;
  const profile = session && auth.profile?.memberId === session.memberId ? auth.profile : null;
  const runtime = getReminderRuntimeOwner();
  const reminders = useReminderRuntimeSnapshot();
  const [profileRetrying, setProfileRetrying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const deletePending = useRef(false);
  useEffect(() => { setConfirmDelete(false); setDeleteError(false); }, [session?.memberId, session?.sessionToken]);
  const deleteAccount = async () => {
    if (!session || deletePending.current) return;
    deletePending.current = true; setDeleting(true); setDeleteError(false);
    try {
      const client = createApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId });
      await client.deleteAccount();
      clearAuthSessionIfCurrent(session);
    } catch { setDeleteError(true); }
    finally { deletePending.current = false; setDeleting(false); }
  };
  const model = buildAccountSurfaceModel({ status: auth.status, profile, profileStatus: auth.profileStatus });
  const saveReminderSettings = async (next: Partial<{ readingEnabled: boolean; meetingEnabled: boolean; readingTime: string; meetingAdvanceMinutes: number }>) => {
    await runtime?.savePreferences(next);
  };
  const signOut = () => { clearAuthSession(); };
  const versionLabel = appVersionLabel(Application.nativeApplicationVersion, Application.nativeBuildVersion,
    { isEmbeddedLaunch: Updates.isEmbeddedLaunch, updateId: Updates.updateId, createdAt: Updates.createdAt });

  if (confirmDelete && session) return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>刪除帳號與資料</Text>
    <Text style={styles.body}>這會永久刪除你的帳號與伺服器上的個人資料，無法復原。</Text>
    <Text style={styles.body}>讀經進度、積分和好友資料也會刪除。</Text>
    <Text style={styles.body}>刪除完成後會登出，回到登入頁。</Text>
    {deleteError ? <Text accessibilityRole="alert" style={styles.error}>目前無法刪除帳號，請檢查網路後重試。</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="取消" disabled={deleting} onPress={() => { setConfirmDelete(false); setDeleteError(false); }} style={styles.secondary}><Text style={styles.secondaryText}>取消</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="確認刪除" accessibilityState={{ busy: deleting, disabled: deleting }} disabled={deleting} onPress={deleteAccount} style={styles.destructive}><Text style={styles.destructiveText}>{deleting ? '正在刪除帳號…' : '確認刪除'}</Text></Pressable>
  </View>;
  return (
    <View style={styles.card}>
      {model.mode === 'signed-in' && profile ? <>
        {model.avatarUrl ? <Image accessibilityLabel={`帳戶頭像：${profile.displayName}`} source={{ uri: model.avatarUrl }} style={styles.avatarImage} /> : <Text style={styles.avatar}>{model.avatarLabel}</Text>}
        <Text style={styles.title}>{profile.displayName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="登出" onPress={signOut} style={styles.secondary}><Text style={styles.secondaryText}>登出</Text></Pressable>
        <ReminderSettings
          {...reminders}
          onRetry={async () => { if (reminders.error === 'save') await runtime?.retrySave(); else await runtime?.retryLoad(); }}
          onReadingChange={(enabled) => { void saveReminderSettings({ readingEnabled: enabled }); }}
          onMeetingChange={(enabled) => { void saveReminderSettings({ meetingEnabled: enabled }); }}
          onReadingTimeChange={(value) => { void saveReminderSettings({ readingTime: value }); }}
          onMeetingAdvanceChange={(value) => { void saveReminderSettings({ meetingAdvanceMinutes: value }); }}
          onOpenSettings={() => { void Linking.openSettings(); }}
          showMeeting={false}
        />
        <CongregationSetting />
        {adminEntry}

      </> : model.mode === 'loading' || model.mode === 'error' || model.mode === 'empty' ? <>
        <Text style={styles.title}>{model.mode === 'error' ? '暫時無法載入帳戶資料' : model.mode === 'empty' ? '尚未取得帳戶資料' : '正在載入帳戶資料'}</Text>
        <Text style={styles.body}>{model.mode === 'loading' ? '身份已確認，正在取得個人資料；若網路不穩，請重試。' : '身份已確認，可以重新載入個人資料。'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="重試載入帳戶資料" disabled={profileRetrying} onPress={() => { setProfileRetrying(true); void retryAuthProfile().catch(() => undefined).finally(() => setProfileRetrying(false)); }} style={styles.secondary}><Text style={styles.secondaryText}>{profileRetrying ? '載入中…' : '重試載入'}</Text></Pressable>
      </> : <>
        <Text style={styles.title}>{model.mode === 'reauthenticate' ? '登入狀態已過期' : '竹科聖經帳戶'}</Text>
        <GoogleLoginCard baseUrl={runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl} />
      </>}
      {auth.status === 'signed-in' && session ? <Pressable accessibilityRole="button" accessibilityLabel="刪除帳號與資料" onPress={() => { setConfirmDelete(true); }} style={styles.quiet}><Text style={styles.quietText}>刪除帳號與資料</Text></Pressable> : null}
      {/* Shown in every state, including a profile that failed to load: that tester still needs to say which build they have. */}
      {versionLabel ? <Text style={styles.version}>{versionLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The identity block reads left-aligned like a member row on a printed roster.
  // The 72dp centred avatar was the only element on the screen with no job.
  card: { flexGrow: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.background },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary, color: theme.colors.white, fontSize: theme.type.metric.size, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center' },
  avatarImage: { width: 56, height: 56, borderRadius: 28, borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline },
  title: { color: theme.colors.ink, fontSize: theme.type.display.size, lineHeight: theme.type.display.line, fontWeight: '800' },
  body: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  secondary: { minHeight: theme.control.tap, borderColor: theme.colors.primary, borderWidth: theme.control.hairline, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  destructive: { minHeight: theme.control.tap, borderRadius: theme.radius.button, backgroundColor: theme.colors.danger, alignItems: 'center', justifyContent: 'center' },
  destructiveText: { color: theme.colors.white, fontSize: theme.type.label.size, fontWeight: '700' },
  error: { color: theme.colors.danger, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  quiet: { minHeight: theme.control.tap, alignSelf: 'flex-start', justifyContent: 'center' },
  version: { marginTop: 'auto', color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  quietText: { color: theme.colors.danger, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, textDecorationLine: 'underline' },
});
