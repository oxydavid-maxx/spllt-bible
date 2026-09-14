import type {
  NotificationPermissionsStatus,
  NotificationRequest,
  NotificationRequestInput,
  NotificationTriggerInput,
} from 'expo-notifications';

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

/** The account-owned reading schedule projected by /api/me/reading-days. */
export interface ReadingScheduleEntry {
  taskDate: string;
  planId: string;
  scheduleRevision?: number;
}

export interface ReminderNotificationAdapter {
  getPermissionsAsync: () => Promise<NotificationPermissionsStatus>;
  requestPermissionsAsync: () => Promise<NotificationPermissionsStatus>;
  scheduleNotificationAsync: (request: NotificationRequestInput) => Promise<string>;
  cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
  getAllScheduledNotificationsAsync: () => Promise<NotificationRequest[]>;
  setNotificationChannelAsync?: (channelId: string, configuration: { name: string; importance: number; vibrationPattern: number[] }) => Promise<unknown>;
}

export const REMINDER_NOTIFICATION_CHANNEL_ID = 'qingmu-reading-reminders';

export function buildNextReadingReminderSpec(memberId: string, readingTime: string, now = new Date(), schedule: readonly ReadingScheduleEntry[] = []): ReminderSpec | null {
  return buildUpcomingReadingReminderSpecs(memberId, readingTime, now, schedule)[0] ?? null;
}

export function buildUpcomingReadingReminderSpecs(memberId: string, readingTime: string, now = new Date(), schedule: readonly ReadingScheduleEntry[] = []): ReminderSpec[] {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(readingTime)) return [];
  return schedule
    .filter((entry) => validDateOnly(entry.taskDate) && entry.planId.trim().length > 0)
    .map((entry) => buildReadingSpec(memberId, entry.taskDate, entry.planId, readingTime, entry.scheduleRevision ?? 0))
    .filter((spec) => new Date(spec.triggerAt).getTime() > now.getTime())
    .sort((left, right) => left.triggerAt.localeCompare(right.triggerAt));
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function buildReadingSpec(memberId: string, taskDate: string, planId: string, readingTime: string, scheduleRevision: number): ReminderSpec {
  return {
    reminderId: `reading:${memberId}:${taskDate}`,
    memberId,
    kind: 'READING',
    targetId: planId,
    taskDate,
    scheduleRevision,
    triggerAt: new Date(`${taskDate}T${readingTime}:00+08:00`).toISOString(),
    route: `/today?date=${taskDate}`,
    status: 'ACTIVE',
  };
}

export function buildReadingReminderSpecForDate(memberId: string, taskDate: string, readingTime: string, planId: string, scheduleRevision = 0): ReminderSpec | null {
  if (!validDateOnly(taskDate) || !planId.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(readingTime)) return null;
  return buildReadingSpec(memberId, taskDate, planId, readingTime, scheduleRevision);
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

function triggerDateOf(request: NotificationRequest): Date | null {
  const trigger: unknown = request.trigger;
  if (!trigger || typeof trigger !== 'object') return null;
  // Android DateTrigger.toBundle returns value in epoch milliseconds, not date.
  if ('type' in trigger && trigger.type === 'date' && 'value' in trigger) {
    return typeof trigger.value === 'number' ? new Date(trigger.value) : null;
  }
  if ((!('type' in trigger) || trigger.type === 'date') && 'date' in trigger) {
    return trigger.date instanceof Date ? trigger.date : typeof trigger.date === 'number' ? new Date(trigger.date) : null;
  }
  // iOS converts a date input to a non-repeating time interval. Its readback
  // omits the scheduling instant, so recover only our persisted canonical time.
  if ('type' in trigger && trigger.type === 'timeInterval'
    && 'repeats' in trigger && trigger.repeats === false
    && 'seconds' in trigger && typeof trigger.seconds === 'number' && Number.isFinite(trigger.seconds) && trigger.seconds > 0) {
    const triggerAt = request.content.data?.triggerAt;
    const date = typeof triggerAt === 'string' ? new Date(triggerAt) : null;
    return date && Number.isFinite(date.getTime()) && date.toISOString() === triggerAt ? date : null;
  }
  return null;
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

  async function cancelRetiredMeetingReminders(): Promise<void> {
    const scheduled = await adapter.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled
      .filter((request) => request.content.data?.kind === 'MEETING' || reminderIdOf(request)?.startsWith('meeting:'))
      .map((request) => adapter.cancelScheduledNotificationAsync(request.identifier)));
  }

  async function requestPermission(): Promise<'granted' | 'denied'> {
    await adapter.setNotificationChannelAsync?.(REMINDER_NOTIFICATION_CHANNEL_ID, { name: '青牧提醒', importance: 4, vibrationPattern: [0, 250, 250, 250] });
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
    const triggerDate = new Date(spec.triggerAt);
    await adapter.scheduleNotificationAsync({
      content: {
        title: '青牧讀經提醒',
        body: '今天的讀經任務已準備好。',
        data: { reminderId: spec.reminderId, kind: spec.kind, memberId: spec.memberId, targetId: spec.targetId, taskDate: spec.taskDate ?? null, scheduleRevision: spec.scheduleRevision, route: spec.route, triggerAt: triggerDate.toISOString() },
      },
      trigger: { type: 'date', date: triggerDate, channelId: REMINDER_NOTIFICATION_CHANNEL_ID } as NotificationTriggerInput,
    });
  }

  async function list(): Promise<ReminderSpec[]> {
    const scheduled = await adapter.getAllScheduledNotificationsAsync();
    return scheduled.flatMap((request) => {
      const data = request.content.data ?? {};
      if (typeof data.reminderId !== 'string' || data.kind !== 'READING' || typeof data.memberId !== 'string' || typeof data.route !== 'string') return [];
      const triggerDate = triggerDateOf(request);
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

  return { schedule, cancel, cancelForMember, cancelRetiredMeetingReminders, list, requestPermission };
}

export type ReminderScheduler = Omit<ReturnType<typeof createReminderScheduler>, 'cancelRetiredMeetingReminders'> & {
  cancelRetiredMeetingReminders?: () => Promise<void>;
};
