import type { DatabaseSync } from 'node:sqlite';
import { sendDueMeetingEvent, type DueMeetingEvent, type MeetingSender } from './remoteReminders';
export interface ReminderWorkerTimer { setInterval: (handler: () => Promise<void>, milliseconds: number) => unknown; clearInterval: (handle: unknown) => void }

export function discoverDueMeetingEvents(db: DatabaseSync, now = new Date()): DueMeetingEvent[] {
  const rows = db.prepare(`SELECT p.member_id,p.meeting_id,p.schedule_revision,p.starts_at,r.meeting_advance_minutes
    FROM member_group_profiles p JOIN members m ON m.id=p.member_id AND m.disabled_at IS NULL JOIN reminder_preferences r ON r.member_id=p.member_id AND r.meeting_enabled=1
    WHERE p.meeting_id IS NOT NULL AND p.schedule_status='SCHEDULED' AND p.schedule_revision IS NOT NULL AND p.starts_at IS NOT NULL AND length(trim(p.schedule_source_ref))>0
      AND EXISTS (SELECT 1 FROM device_delivery_tokens d WHERE d.member_id=p.member_id AND d.platform='ANDROID' AND d.revoked_at IS NULL)
    ORDER BY p.starts_at,p.meeting_id,p.member_id`).all() as Array<{ member_id: string; meeting_id: string; schedule_revision: number; starts_at: string; meeting_advance_minutes: number }>;
  return rows.flatMap(row => {
    const trigger = Date.parse(row.starts_at) - row.meeting_advance_minutes * 60_000;
    if (!Number.isFinite(trigger) || trigger > now.getTime() || trigger + 300_000 <= now.getTime()) return [];
    return [{ reminderId: `meeting:${row.meeting_id}:${row.schedule_revision}`, memberId: row.member_id, meetingId: row.meeting_id, scheduleRevision: row.schedule_revision, triggerAt: new Date(trigger).toISOString(), expiresAt: new Date(trigger + 300_000).toISOString() }];
  });
}

export function createReminderWorker(options: { db: DatabaseSync; send: MeetingSender; now?: () => Date; intervalMs?: number; timer?: ReminderWorkerTimer }) {
  const now = options.now ?? (() => new Date());
  const timer = options.timer ?? { setInterval: (callback: () => Promise<void>, delay: number) => setInterval(callback, delay), clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>) };
  let handle: unknown = null;
  let running = false;
  let tail: Promise<void> = Promise.resolve();
  let lastError: string | null = null;
  async function tick() { for (const event of discoverDueMeetingEvents(options.db, now())) await sendDueMeetingEvent(options.db, event, options.send, now()); }
  function scheduledTick() { tail = tail.then(async () => { if (running) await tick(); }).catch(() => { lastError = 'REMINDER_TICK_FAILED'; }); return tail; }
  return {
    tick,
    start() { if (!running) { running = true; handle = timer.setInterval(scheduledTick, Math.max(1000, options.intervalMs ?? 15_000)); } },
    async stop() { running = false; if (handle !== null) timer.clearInterval(handle); handle = null; await tail; },
    getStatus: () => ({ running, lastError }),
  };
}
