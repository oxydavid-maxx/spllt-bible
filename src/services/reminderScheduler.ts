import type {
  NotificationPermissionsStatus,
  NotificationRequest,
  NotificationRequestInput,
  NotificationTriggerInput,
} from 'expo-notifications';
import { canonicalSeptemberPlan } from '../domain/calendar';

export type ReminderKind = 'READING' | 'MEETING';
export type ReminderStatus = 'ACTIVE' | 'CANCELLED';

export interface ReminderSpec {
  reminderId: string;
  memberId: string;
  kind: ReminderKind;
  targetId: string;
  taskDate?: string;
  meetingId?: string;
  scheduleRevision: number;
  triggerAt: string;
  route: string;
  status: ReminderStatus;
}

export interface ReminderNotificationAdapter {
  getPermissionsAsync: () => Promise<NotificationPermissionsStatus>;
  requestPermissionsAsync: () => Promise<NotificationPermissionsStatus>;
  scheduleNotificationAsync: (request: NotificationRequestInput) => Promise<string>;
  cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
  getAllScheduledNotificationsAsync: () => Promise<NotificationRequest[]>;
  setNotificationChannelAsync?: (channelId: string, configuration: { name: string; importance: number; vibrationPattern: number[] }) => Promise<unknown>;
}

const CHANNEL_ID = 'qingmu-reading-reminders';

export function buildNextReadingReminderSpec(memberId: string, readingTime: string, now = new Date()): ReminderSpec | null {
  return buildUpcomingReadingReminderSpecs(memberId, readingTime, now)[0] ?? null;
}

export function buildUpcomingReadingReminderSpecs(memberId: string, readingTime: string, now = new Date()): ReminderSpec[] {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(readingTime)) return [];
  return canonicalSeptemberPlan.dates
    .map((taskDate) => buildReadingSpec(memberId, taskDate, readingTime))
    .filter((spec) => new Date(spec.triggerAt).getTime() > now.getTime());
}

function buildReadingSpec(memberId: string, taskDate: string, readingTime: string): ReminderSpec {
  return {
    reminderId: `reading:${memberId}:${taskDate}`,
    memberId,
    kind: 'READING',
    targetId: 'church-2026-09',
    taskDate,
    scheduleRevision: 0,
    triggerAt: new Date(`${taskDate}T${readingTime}:00+08:00`).toISOString(),
    route: `/today?date=${taskDate}`,
    status: 'ACTIVE',
  };
}

export function buildReadingReminderSpecForDate(memberId: string, taskDate: string, readingTime: string): ReminderSpec | null {
  if (!/^2026-09-\d{2}$/.test(taskDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(readingTime)) return null;
  return buildReadingSpec(memberId, taskDate, readingTime);
}

const nativeNotifications: ReminderNotificationAdapter = {
  getPermissionsAsync: async () => (await import('expo-notifications')).getPermissionsAsync(),
  requestPermissionsAsync: async () => (await import('expo-notifications')).requestPermissionsAsync(),
  scheduleNotificationAsync: async (request) => (await import('expo-notifications')).scheduleNotificationAsync(request),
  cancelScheduledNotificationAsync: async (identifier) => (await import('expo-notifications')).cancelScheduledNotificationAsync(identifier),
  getAllScheduledNotificationsAsync: async () => (await import('expo-notifications')).getAllScheduledNotificationsAsync(),
  setNotificationChannelAsync: async (channelId, configuration) => (await import('expo-notifications')).setNotificationChannelAsync(channelId, configuration),
};

function reminderIdOf(request: NotificationRequest): string | null {
  const value = request.content.data?.reminderId;
  return typeof value === 'string' ? value : null;
}

function permissionGranted(status: NotificationPermissionsStatus): boolean {
  return status.granted === true || status.ios?.status === 2 || status.ios?.status === 3;
}

export function createReminderScheduler(adapter: ReminderNotificationAdapter = nativeNotifications) {
  async function cancel(reminderId: string): Promise<void> {
    const scheduled = await adapter.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((request) => reminderIdOf(request) === reminderId)
        .map((request) => adapter.cancelScheduledNotificationAsync(request.identifier)),
    );
  }

  async function cancelForMember(memberId: string): Promise<void> {
    const scheduled = await list();
    await Promise.all(scheduled.filter((request) => request.memberId === memberId).map((request) => cancel(request.reminderId)));
  }

  async function requestPermission(): Promise<'granted' | 'denied'> {
    await adapter.setNotificationChannelAsync?.(CHANNEL_ID, { name: '青牧提醒', importance: 4, vibrationPattern: [0, 250, 250, 250] });
    const current = await adapter.getPermissionsAsync();
    if (permissionGranted(current)) return 'granted';
    const requested = await adapter.requestPermissionsAsync();
    return permissionGranted(requested) ? 'granted' : 'denied';
  }

  async function schedule(spec: ReminderSpec): Promise<void> {
    if (spec.kind !== 'READING') throw new Error('REMOTE_MEETING_REMINDER_REQUIRED');
    if (spec.status === 'CANCELLED') {
      await cancel(spec.reminderId);
      return;
    }
    if (await requestPermission() !== 'granted') throw new Error('NOTIFICATION_PERMISSION_DENIED');
    await cancel(spec.reminderId);
    await adapter.scheduleNotificationAsync({
      content: {
        title: '青牧讀經提醒',
        body: '今天的讀經任務已準備好。',
        data: { reminderId: spec.reminderId, kind: spec.kind, memberId: spec.memberId, targetId: spec.targetId, taskDate: spec.taskDate ?? null, scheduleRevision: spec.scheduleRevision, route: spec.route },
      },
      trigger: { type: 'date', date: new Date(spec.triggerAt) } as NotificationTriggerInput,
    });
  }

  async function list(): Promise<ReminderSpec[]> {
    const scheduled = await adapter.getAllScheduledNotificationsAsync();
    return scheduled.flatMap((request) => {
      const data = request.content.data ?? {};
      if (typeof data.reminderId !== 'string' || data.kind !== 'READING' || typeof data.memberId !== 'string' || typeof data.route !== 'string') return [];
      const rawDate = request.trigger && typeof request.trigger === 'object' && 'date' in request.trigger ? (request.trigger as { date?: Date | number }).date : undefined;
      const triggerDate = rawDate instanceof Date ? rawDate : typeof rawDate === 'number' ? new Date(rawDate) : null;
      return [{
        reminderId: data.reminderId,
        memberId: data.memberId,
        kind: 'READING' as const,
        targetId: typeof data.targetId === 'string' ? data.targetId : data.reminderId,
        ...(typeof data.taskDate === 'string' ? { taskDate: data.taskDate } : {}),
        scheduleRevision: typeof data.scheduleRevision === 'number' ? data.scheduleRevision : 0,
        triggerAt: triggerDate && Number.isFinite(triggerDate.getTime()) ? triggerDate.toISOString() : new Date(0).toISOString(),
        route: data.route,
        status: 'ACTIVE' as const,
      }];
    });
  }

  return { schedule, cancel, cancelForMember, list, requestPermission };
}

export type ReminderScheduler = ReturnType<typeof createReminderScheduler>;
