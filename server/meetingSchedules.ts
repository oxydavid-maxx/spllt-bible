import type { DatabaseSync } from 'node:sqlite';

export type MeetingStatus = 'SCHEDULED' | 'CANCELLED';
export interface MeetingSchedule {
  memberId: string; rpgId: string; meetingId: string; title: string;
  startsAt: string; timeZone: string; revision: number; status: MeetingStatus;
}
export function ensureMeetingSchema(db: DatabaseSync): void {
  const columns = new Set(db.prepare('PRAGMA table_info(member_group_profiles)').all().map(row => row.name));
  const additions: Record<string, string> = { meeting_id: 'TEXT', meeting_title: 'TEXT', starts_at: 'TEXT', time_zone: 'TEXT', schedule_revision: 'INTEGER', schedule_status: 'TEXT', last_updated_at: 'TEXT', schedule_source_ref: 'TEXT' };
  db.exec('SAVEPOINT meeting_schema');
  try {
    for (const [name, type] of Object.entries(additions)) if (!columns.has(name)) db.exec(`ALTER TABLE member_group_profiles ADD COLUMN ${name} ${type}`);
    db.exec(`CREATE TABLE IF NOT EXISTS reminder_deliveries (
      delivery_id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL, member_id TEXT NOT NULL,
      meeting_id TEXT NOT NULL, schedule_revision INTEGER NOT NULL, trigger_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, status TEXT NOT NULL, claimed_at TEXT, sent_at TEXT,
      provider_message_id TEXT, last_error TEXT
    )`);
    db.exec('RELEASE meeting_schema');
  } catch (error) { db.exec('ROLLBACK TO meeting_schema; RELEASE meeting_schema'); throw error; }
}

function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function parseInput(value: unknown): { sourceRef: string; schedules: MeetingSchedule[] } {
  if (!value || typeof value !== 'object') throw new Error('INVALID_MEETING_IMPORT');
  const input = value as Record<string, unknown>;
  if (!text(input.sourceRef) || !Array.isArray(input.schedules) || !input.schedules.length) throw new Error('INVALID_MEETING_IMPORT');
  const targets = new Set<string>();
  const schedules = input.schedules.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('INVALID_MEETING_SCHEDULE');
    const row = raw as Record<string, unknown>;
    if (!['memberId', 'rpgId', 'meetingId', 'title', 'startsAt', 'timeZone'].every(key => text(row[key])) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || (row.status !== 'SCHEDULED' && row.status !== 'CANCELLED')) throw new Error('INVALID_MEETING_SCHEDULE');
    const time = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(row.startsAt as string);
    if (!time || !Number.isFinite(Date.parse(row.startsAt as string))) throw new Error('INVALID_MEETING_TIME');
    const calendar = new Date(`${time[1]}-${time[2]}-${time[3]}T00:00:00.000Z`);
    if (calendar.getUTCFullYear() !== Number(time[1]) || calendar.getUTCMonth()+1 !== Number(time[2]) || calendar.getUTCDate() !== Number(time[3])) throw new Error('INVALID_MEETING_TIME');
    try { new Intl.DateTimeFormat('en', { timeZone: row.timeZone as string }); } catch { throw new Error('INVALID_MEETING_TIME_ZONE'); }
    const result: MeetingSchedule = { memberId: (row.memberId as string).trim(), rpgId: (row.rpgId as string).trim(), meetingId: (row.meetingId as string).trim(), title: (row.title as string).trim(), startsAt: new Date(row.startsAt as string).toISOString(), timeZone: (row.timeZone as string).trim(), revision: row.revision as number, status: row.status };
    const key = JSON.stringify([result.memberId, result.rpgId]);
    if (targets.has(key)) throw new Error('INVALID_DUPLICATE_MEETING_TARGET');
    targets.add(key); return result;
  });
  return { sourceRef: input.sourceRef.trim(), schedules };
}

export function importMeetingSchedules(db: DatabaseSync, raw: unknown, options: { apply?: boolean; now?: string } = {}) {
  const input = parseInput(raw);
  // One transaction binds target/revision checks to all writes. Dry-run never opens a write transaction.
  if (options.apply) db.exec('BEGIN IMMEDIATE');
  try {
    const changes: MeetingSchedule[] = [];
    for (const row of input.schedules) {
      const current = db.prepare(`SELECT p.meeting_id, p.meeting_title, p.starts_at, p.time_zone, p.schedule_revision, p.schedule_status, p.schedule_source_ref
        FROM member_group_profiles p JOIN members m ON m.id = p.member_id WHERE p.member_id = ? AND p.rpg_id = ?`).get(row.memberId, row.rpgId) as { meeting_id: string | null; meeting_title: string | null; starts_at: string | null; time_zone: string | null; schedule_revision: number | null; schedule_status: string | null; schedule_source_ref: string | null } | undefined;
      if (!current) throw new Error('UNKNOWN_MEETING_TARGET');
      if (current.meeting_id === row.meetingId && current.schedule_revision !== null) {
        if (row.revision < current.schedule_revision) throw new Error('STALE_MEETING_REVISION');
        if (row.revision === current.schedule_revision) {
          if (current.meeting_title !== row.title || current.starts_at !== row.startsAt || current.time_zone !== row.timeZone || current.schedule_status !== row.status) throw new Error('MEETING_REVISION_CONFLICT');
          if (current.schedule_source_ref?.trim()) continue;
        }
      }
      changes.push(row);
    }
    if (options.apply) {
      const update = db.prepare(`UPDATE member_group_profiles SET meeting_id=?, meeting_title=?, starts_at=?, time_zone=?, schedule_revision=?, schedule_status=?, last_updated_at=?, schedule_source_ref=? WHERE member_id=? AND rpg_id=?`);
      for (const row of changes) update.run(row.meetingId, row.title, row.startsAt, row.timeZone, row.revision, row.status, options.now ?? new Date().toISOString(), input.sourceRef, row.memberId, row.rpgId);
      db.exec('COMMIT');
    }
    return { applied: options.apply === true, changed: changes.length, unchanged: input.schedules.length - changes.length };
  } catch (error) { if (options.apply) db.exec('ROLLBACK'); throw error; }
}

export function readMeetingSchedules(db: DatabaseSync, memberId: string, advanceMinutes: number) {
  const rows = db.prepare(`SELECT meeting_id, meeting_title, starts_at, time_zone, schedule_revision, schedule_status FROM member_group_profiles
    WHERE member_id=? AND meeting_id IS NOT NULL AND schedule_revision IS NOT NULL AND length(trim(schedule_source_ref))>0 AND schedule_status IN ('SCHEDULED','CANCELLED') ORDER BY starts_at,rpg_id`).all(memberId) as Array<{ meeting_id: string; meeting_title: string; starts_at: string; time_zone: string; schedule_revision: number; schedule_status: MeetingStatus }>;
  return rows.map(row => ({ reminderId: `meeting:${row.meeting_id}`, meetingId: row.meeting_id, title: row.meeting_title, startsAt: row.starts_at, timeZone: row.time_zone, scheduleRevision: row.schedule_revision, status: row.schedule_status, triggerAt: Number.isFinite(Date.parse(row.starts_at)) ? new Date(Date.parse(row.starts_at) - advanceMinutes * 60_000).toISOString() : null, route: '/groups' }));
}
