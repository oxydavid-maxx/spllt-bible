import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { clearAuthSession, retryAuthProfile, useAuthSnapshot } from '../services/authSession';
import { runtimeConfig } from '../config/runtime';
import { GoogleLoginCard } from './GoogleLoginCard';
import { buildAccountSurfaceModel } from './accountSurface';
import { theme } from './Theme';
import { ReminderSettings } from './ReminderSettings';
import { getReminderRuntimeOwner, useReminderRuntimeSnapshot } from '../services/reminderRuntime';

export function AccountSurface() {
  const auth = useAuthSnapshot();
  const session = auth.session;
  const profile = session && auth.profile?.memberId === session.memberId ? auth.profile : null;
  const runtime = getReminderRuntimeOwner();
  const reminders = useReminderRuntimeSnapshot();
  const [profileRetrying, setProfileRetrying] = useState(false);
  const model = buildAccountSurfaceModel({ status: auth.status, profile, profileStatus: auth.profileStatus });
  const saveReminderSettings = async (next: Partial<{ readingEnabled: boolean; meetingEnabled: boolean; readingTime: string; meetingAdvanceMinutes: number }>) => {
    await runtime?.savePreferences(next);
  };
  const signOut = () => { clearAuthSession(); };

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
      </> : model.mode === 'loading' || model.mode === 'error' || model.mode === 'empty' ? <>
        <Text style={styles.title}>{model.mode === 'error' ? '暫時無法載入帳戶資料' : model.mode === 'empty' ? '尚未取得帳戶資料' : '正在載入帳戶資料'}</Text>
        <Text style={styles.body}>{model.mode === 'loading' ? '身份已確認，正在取得個人資料；若網路不穩，請重試。' : '身份已確認，可以重新載入個人資料。'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="重試載入帳戶資料" disabled={profileRetrying} onPress={() => { setProfileRetrying(true); void retryAuthProfile().catch(() => undefined).finally(() => setProfileRetrying(false)); }} style={styles.secondary}><Text style={styles.secondaryText}>{profileRetrying ? '載入中…' : '重試載入'}</Text></Pressable>
      </> : <>
        <Text style={styles.title}>{model.mode === 'reauthenticate' ? '登入狀態已過期' : '竹科聖經帳戶'}</Text>
        <GoogleLoginCard baseUrl={runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl} />
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  // The identity block reads left-aligned like a member row on a printed roster.
  // The 72dp centred avatar was the only element on the screen with no job.
  card: { flex: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.background },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary, color: theme.colors.white, fontSize: theme.type.metric.size, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center' },
  avatarImage: { width: 56, height: 56, borderRadius: 28, borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline },
  title: { color: theme.colors.ink, fontSize: theme.type.display.size, lineHeight: theme.type.display.line, fontWeight: '800' },
  body: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
  secondary: { minHeight: theme.control.tap, borderColor: theme.colors.primary, borderWidth: theme.control.hairline, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
});
