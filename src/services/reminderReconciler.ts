import type { ReminderScheduler, ReminderSpec } from './reminderScheduler';

export interface ReminderReconcileSnapshot {
  memberId: string;
  readingEnabled: boolean;
  meetingEnabled: boolean;
  remoteDeliveryStatus: 'LOCAL_ONLY' | 'REMOTE_PENDING' | 'REMOTE_READY';
  reading: ReminderSpec | null;
  readings?: ReminderSpec[];
  meeting: {
    meetingId: string;
    scheduleRevision: number;
    status: 'SCHEDULED' | 'CANCELLED';
  } | null;
}

export interface ReminderReconcileResult {
  created: string[];
  cancelled: string[];
  unchanged: string[];
  deliveryStatus: 'LOCAL_ONLY' | 'REMOTE_PENDING' | 'REMOTE_READY';
}

function meetingReminderId(meetingId: string, revision: number): string {
  return `meeting:${meetingId}:${revision}`;
}

export function createReminderReconciler(scheduler: ReminderScheduler) {
  const knownMeetings = new Map<string, number>();

  return {
    async reconcile(snapshot: ReminderReconcileSnapshot, isAuthorized: () => boolean = () => true): Promise<ReminderReconcileResult> {
      const created: string[] = [];
      const cancelled: string[] = [];
      const unchanged: string[] = [];
      if (!isAuthorized()) return { created, cancelled, unchanged, deliveryStatus: 'LOCAL_ONLY' };
      const existing = await scheduler.list();
      if (!isAuthorized()) return { created, cancelled, unchanged, deliveryStatus: 'LOCAL_ONLY' };
      const owned = existing.filter((reminder) => reminder.memberId === snapshot.memberId);
      const desiredReadings = (snapshot.readings ?? (snapshot.reading ? [snapshot.reading] : [])).filter((reading) => reading.memberId === snapshot.memberId && reading.status === 'ACTIVE' && reading.kind === 'READING' && Boolean(reading.targetId));
      const desiredById = new Map(desiredReadings.map((reading) => [reading.reminderId, reading]));
      const existingReading = owned.filter((reminder) => reminder.kind === 'READING');
      for (const reminder of existingReading) {
        if (!isAuthorized()) return { created, cancelled, unchanged, deliveryStatus: 'LOCAL_ONLY' };
        const desired = desiredById.get(reminder.reminderId);
        const same = desired && reminder.taskDate === desired.taskDate && reminder.triggerAt === desired.triggerAt;
        if (same) unchanged.push(reminder.reminderId);
        else {
          await scheduler.cancel(reminder.reminderId);
          cancelled.push(reminder.reminderId);
        }
      }
      if (snapshot.readingEnabled) {
        for (const desiredReading of desiredReadings) {
          if (unchanged.includes(desiredReading.reminderId)) continue;
          if (!isAuthorized()) return { created, cancelled, unchanged, deliveryStatus: 'LOCAL_ONLY' };
          try {
            await scheduler.schedule(desiredReading);
            created.push(desiredReading.reminderId);
            if (!isAuthorized()) await scheduler.cancel(desiredReading.reminderId);
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'NOTIFICATION_PERMISSION_DENIED') throw error;
          }
        }
      }

      let deliveryStatus: ReminderReconcileResult['deliveryStatus'] = 'LOCAL_ONLY';
      if (!isAuthorized()) return { created, cancelled, unchanged, deliveryStatus };
      if (snapshot.meetingEnabled && snapshot.meeting) {
        const priorRevision = knownMeetings.get(snapshot.meeting.meetingId);
        const currentId = meetingReminderId(snapshot.meeting.meetingId, snapshot.meeting.scheduleRevision);
        if (snapshot.meeting.status === 'CANCELLED') {
          if (priorRevision !== undefined) cancelled.push(meetingReminderId(snapshot.meeting.meetingId, priorRevision));
        } else if (priorRevision === undefined) {
          created.push(currentId);
        } else if (priorRevision === snapshot.meeting.scheduleRevision) {
          unchanged.push(currentId);
        } else {
          cancelled.push(meetingReminderId(snapshot.meeting.meetingId, priorRevision));
          created.push(currentId);
        }
        knownMeetings.set(snapshot.meeting.meetingId, snapshot.meeting.scheduleRevision);
        deliveryStatus = snapshot.remoteDeliveryStatus;
      }
      return { created, cancelled, unchanged, deliveryStatus };
    },
  };
}

export function resolveMeetingReminderTap(
  payload: { meetingId: string; scheduleRevision: number },
  latest: { meetingId: string; scheduleRevision: number; status: 'SCHEDULED' | 'CANCELLED' } | null,
): { route: string; meetingId: string } | null {
  if (!latest || latest.meetingId !== payload.meetingId || latest.scheduleRevision !== payload.scheduleRevision || latest.status !== 'SCHEDULED') return null;
  return { route: '/groups', meetingId: latest.meetingId };
}

export type ReminderReconciler = ReturnType<typeof createReminderReconciler>;
