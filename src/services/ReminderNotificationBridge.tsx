import { useEffect, useRef } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { getAuthSnapshot, useAuthSnapshot } from './authSession';
import { validateConfiguredMeetingReminder } from './configuredReminderHeadless';
import { bindReminderNotifications, createReminderNotificationController } from './reminderNotificationEntry';
import { setSelectedReadingDate } from '../ui/readingSession';
import { AppState } from 'react-native';
import type { PendingReminderDeviceRevocations } from './reminderDevice';

/** The sole foreground/interaction notification owner, mounted under the real AuthProvider. */
export function ReminderNotificationBridge({ revokeQueue }: { revokeQueue?: PendingReminderDeviceRevocations }) {
  const auth = useAuthSnapshot();
  const navigation = useRootNavigationState();
  const ready = useRef(false);
  ready.current = Boolean(navigation?.key);
  const bindingRef = useRef<ReturnType<typeof bindReminderNotifications> | null>(null);

  useEffect(() => {
    if (!revokeQueue) return;
    const flush = () => { void revokeQueue.flush().catch(() => { console.warn('提醒撤銷待重試'); }); };
    flush();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') flush(); });
    return () => subscription.remove();
  }, [revokeQueue]);

  useEffect(() => {
    let active = true;
    let binding: ReturnType<typeof bindReminderNotifications> | null = null;
    void import('expo-notifications').then(notifications => {
      if (!active) return;
      const controller = createReminderNotificationController({
        getAuth: getAuthSnapshot,
        canNavigate: () => ready.current,
        defaultActionIdentifier: notifications.DEFAULT_ACTION_IDENTIFIER,
        validateLatest: validateConfiguredMeetingReminder,
        openReadingDate: taskDate => { setSelectedReadingDate(taskDate); router.push('/today'); },
        openMeeting: () => { router.push('/groups'); },
      });
      binding = bindReminderNotifications(notifications, controller);
      bindingRef.current = binding;
      void binding.resume();
    }).catch(() => { console.warn('提醒通知入口初始化失敗'); });
    return () => {
      active = false;
      binding?.dispose();
      if (bindingRef.current === binding) bindingRef.current = null;
    };
  }, []);

  useEffect(() => {
    void bindingRef.current?.resume();
  }, [auth.status, auth.epoch, auth.session?.memberId, auth.session?.sessionToken, navigation?.key]);
  return null;
}
