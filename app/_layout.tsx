import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuthSnapshot, type AuthSession, type VerifiedProfile } from '../src/services/authSession';
import { consumeInterruptedGoogleLogin } from '../src/services/googleNative';
import { AppStack, canUseApp } from '../src/ui/AppStack';
import { UpdatePrompt } from '../src/ui/UpdatePrompt';
import { CongregationGate } from '../src/ui/congregation/CongregationGate';
import { revokeConfiguredReminderDeviceBinding, revokeConfiguredReminderDeviceBindingResult } from '../src/services/configuredReminderHeadless';
import { runtimeConfig } from '../src/config/runtime';
import { createApiClient } from '../src/services/apiClient';
import * as SecureStore from 'expo-secure-store';
import { createReminderScheduler } from '../src/services/reminderScheduler';
import { configureReminderRuntime, ReminderRuntimeOwner } from '../src/services/reminderRuntime';
import { openQingmuRepository } from '../src/storage/mobileDatabase';
import { randomUUID } from 'expo-crypto';
import { ReminderNotificationBridge } from '../src/services/ReminderNotificationBridge';
import { createReminderDeviceRevokeQueue } from '../src/services/reminderDeviceRevokeQueue';
import { getReadingPlanId } from '../src/ui/readingSession';
import { registerConfiguredFriendPushTask } from '../src/services/friendPush';
import { configureChapterAudio } from '../src/services/chapterAudioStartup';
import { OtaUpdateCheck } from '../src/ui/admin/OtaUpdates';
import { ciDiag, startCiStallMonitor } from '../src/ui/ciDiag';

startCiStallMonitor();
const touchData = (e: { nativeEvent: { pageX: number; pageY: number; timestamp: number; touches?: unknown[] } }) => ({ x: Math.round(e.nativeEvent.pageX), y: Math.round(e.nativeEvent.pageY), t: Math.round(e.nativeEvent.timestamp), n: e.nativeEvent.touches?.length ?? -1 });

// At module scope, as the meeting task once was: a push that wakes a closed app has to find the task
// already defined. A phone without the native modules simply has no friend notifications.
void registerConfiguredFriendPushTask().catch(() => undefined);

export default function RootLayout() {
  const authStatus = useAuthSnapshot().status;
  const signedIn = canUseApp(authStatus);
  const hydrating = authStatus === 'hydrating';
  const checkedStartup = useRef(false);
  useEffect(() => {
    if (hydrating || checkedStartup.current) return;
    checkedStartup.current = true;
    // Signed-out starts consume and display the notice on SignInScreen instead.
    if (signedIn) void consumeInterruptedGoogleLogin(true).catch(() => undefined);
  }, [hydrating, signedIn]);
  const [reminderScheduler] = useState(() => createReminderScheduler());
  useEffect(() => { void reminderScheduler.cancelRetiredMeetingReminders().catch(() => undefined); }, [reminderScheduler]);
  // Chapter narration keeps playing on other tabs, in other apps and on a locked screen; without this
  // mode expo-audio pauses it as soon as the app leaves the foreground.
  useEffect(() => { void configureChapterAudio().catch(() => undefined); }, []);
  const [reminderRevokeQueue] = useState(() => createReminderDeviceRevokeQueue({ secureStore: SecureStore, revoke: revokeConfiguredReminderDeviceBindingResult }));
  const [reminderRuntime] = useState(() => new ReminderRuntimeOwner({
    scheduler: reminderScheduler,
    secureStore: SecureStore,
    createApiClient: (session) => createApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId }),
    revokeDeviceBinding: revokeConfiguredReminderDeviceBinding,
    deviceRevokeQueue: reminderRevokeQueue,
    loadNotificationSource: async () => {
      const notifications = await import('expo-notifications');
      return notifications;
    },
    generateInstallationId: randomUUID,
    getCompletionStatus: (memberId, taskDate, planId) => {
      try {
        const resolvedPlanId = planId ?? getReadingPlanId(taskDate);
        return resolvedPlanId ? openQingmuRepository().get({ memberId, planId: resolvedPlanId, taskDate })?.status ?? null : null;
      } catch { return null; }
    },
  }));
  const loadProfile = useCallback(async (session: AuthSession): Promise<VerifiedProfile | null> => {
    const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
    return createApiClient({ baseUrl: config.apiBaseUrl, token: session.sessionToken, memberId: session.memberId }).getProfile();
  }, []);
  configureReminderRuntime(reminderRuntime);
  // The gesture root stays for react-native-gesture-handler users; the SDK's sheets no longer need it (they are the app's own, src/ui/sheet/bottomSheet.tsx).
  // OtaUpdateCheck stays outside the hydrating gate: it waits for a definite member itself on a preview phone.
  return <GestureHandlerRootView style={{ flex: 1 }} onTouchStartCapture={(e) => ciDiag('touch-start', touchData(e))} onTouchEndCapture={(e) => ciDiag('touch-end', touchData(e))} onTouchCancelCapture={(e) => ciDiag('touch-cancel', touchData(e))}><AuthProvider loadProfile={loadProfile}><OtaUpdateCheck /><ReminderNotificationBridge revokeQueue={reminderRevokeQueue} /><StatusBar style="dark" /><AppStack signedIn={signedIn} hydrating={hydrating} />{!hydrating && <><CongregationGate /><UpdatePrompt /></>}</AuthProvider></GestureHandlerRootView>;
}
