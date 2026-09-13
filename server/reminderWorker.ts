import type { DatabaseSync } from 'node:sqlite';
import { sendDueMeetingEvent, type DueMeetingEvent } from './reminders';

export interface ReminderWorkerTimer {
  setInterval: (handler: () => void | Promise<void>, timeoutMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export interface ReminderWorkerOptions {
  db: DatabaseSync;
  send: (token: string, payload: { event: 'MEETING_REMINDER'; reminderId: string; meetingId: string; scheduleRevision: number }) => Promise<void | { messageId?: string | null }>;
  now?: () => Date;
  intervalMs?: number;
  timer?: ReminderWorkerTimer;
}

export function discoverDueMeetingEvents(db: DatabaseSync, now = new Date()): DueMeetingEvent[] {
  const rows = db.prepare(
    `SELECT p.member_id, p.meeting_id, p.schedule_revision, p.starts_at, r.meeting_advance_minutes
       FROM member_group_profiles p
       JOIN reminder_preferences r ON r.member_id = p.member_id AND r.meeting_enabled = 1
      WHERE p.meeting_id IS NOT NULL
        AND p.schedule_status = 'SCHEDULED'
        AND p.schedule_revision IS NOT NULL
        AND p.starts_at IS NOT NULL
        AND p.starts_at <= ?
        AND EXISTS (SELECT 1 FROM device_delivery_tokens d WHERE d.member_id = p.member_id AND d.platform = 'ANDROID' AND d.revoked_at IS NULL)
      ORDER BY p.starts_at, p.meeting_id, p.member_id`,
  ).all(new Date(now.getTime() + 24 * 60 * 60_000).toISOString()) as Array<{ member_id: string; meeting_id: string; schedule_revision: number; starts_at: string; meeting_advance_minutes: number }>;
  return rows.map((row) => {
    const triggerAt = new Date(Date.parse(row.starts_at) - row.meeting_advance_minutes * 60_000).toISOString();
    return {
      reminderId: `meeting:${row.meeting_id}:${row.schedule_revision}`,
      memberId: row.member_id,
      meetingId: row.meeting_id,
      scheduleRevision: row.schedule_revision,
      triggerAt,
      expiresAt: new Date(Date.parse(triggerAt) + 300_000).toISOString(),
    };
  }).filter((event) => Date.parse(event.triggerAt) <= now.getTime());
}

export function createReminderWorker(options: ReminderWorkerOptions) {
  const now = options.now ?? (() => new Date());
  const intervalMs = Math.max(1000, options.intervalMs ?? 15_000);
  const timer: ReminderWorkerTimer = options.timer ?? {
    setInterval: (handler, timeoutMs) => setInterval(handler, timeoutMs),
    clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  };
  let handle: unknown = null;
  let tail: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    const due = discoverDueMeetingEvents(options.db, now());
    for (const event of due) {
      const result = await sendDueMeetingEvent(options.db, event, options.send, now());
      if (result.decision === 'SEND' || result.decision === 'ALREADY_SENT' || result.decision.startsWith('DROP_')) continue;
    }
  }

  function scheduleTick(): Promise<void> {
    tail = tail.then(() => tick()).catch(() => undefined);
    return tail;
  }

  return {
    tick,
    start(): void {
      if (handle !== null) return;
      handle = timer.setInterval(scheduleTick, intervalMs);
    },
    stop(): void {
      if (handle === null) return;
      timer.clearInterval(handle);
      handle = null;
    },
  };
}
