import { runtimeConfig } from '../config/runtime';
import { REMINDER_DEVICE_TOKEN_KEY, REMINDER_INSTALLATION_KEY } from './reminderDevice';
import { presentValidatedMeetingReminder, registerDefaultReminderHeadlessTask, type HeadlessMeetingPayload } from './reminderDelivery';

export async function registerConfiguredReminderHeadlessTask(): Promise<void> {
  const secureStore = await import('expo-secure-store');
  const config = runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL });
  await registerDefaultReminderHeadlessTask({
    validateLatest: async (payload: HeadlessMeetingPayload) => {
      const installationId = await secureStore.getItemAsync(REMINDER_INSTALLATION_KEY);
      const token = await secureStore.getItemAsync(REMINDER_DEVICE_TOKEN_KEY);
      if (!installationId || !token) return { valid: false, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'CANCELLED' as const };
      const response = await fetch(`${config.apiBaseUrl}/api/device/reminders/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-qingmu-installation-id': installationId, 'x-qingmu-device-token': token },
        body: JSON.stringify({ meeting_id: payload.meetingId, schedule_revision: payload.scheduleRevision }),
      });
      if (!response.ok) return { valid: false, meetingId: payload.meetingId, scheduleRevision: payload.scheduleRevision, status: 'CANCELLED' as const };
      return await response.json() as { valid: boolean; meetingId: string; scheduleRevision: number; status: 'SCHEDULED' | 'CANCELLED' };
    },
    present: presentValidatedMeetingReminder,
  });
}
