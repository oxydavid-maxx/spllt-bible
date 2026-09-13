import type { DatabaseSync } from 'node:sqlite';

export type ReminderKind = 'READING' | 'MEETING';
export type ReminderStatus = 'ACTIVE' | 'CANCELLED';
export type RemoteDeliveryStatus = 'LOCAL_ONLY' | 'REMOTE_PENDING' | 'REMOTE_READY';

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

export interface DueMeetingEvent {
  reminderId: string;
  memberId: string;
  meetingId: string;
  scheduleRevision: number;
  triggerAt: string;
  expiresAt: string;
}

export type DueDecision = 'SEND' | 'ALREADY_SENT' | 'UNKNOWN_RECONCILE' | 'NOT_DUE' | 'DROP_EXPIRED' | 'DROP_STALE' | 'DROP_CANCELLED' | 'DROP_UNKNOWN';

export interface DueMeetingResult {
  decision: DueDecision;
  reminderId: string;
  meetingId: string;
  scheduleRevision: number;
  latestRevision?: number;
  latestStatus?: string;
  token?: string;
  payload?: { event: 'MEETING_REMINDER'; reminderId: string; meetingId: string; scheduleRevision: number };
}

export interface AuthorizedDeviceMeetingSnapshot {
  memberId: string;
  meetingId: string;
  scheduleRevision: number;
  status: 'SCHEDULED' | 'CANCELLED';
}

export interface ReminderPreferenceSnapshot {
  memberId: string;
  readingEnabled: boolean;
  meetingEnabled: boolean;
  readingTime: string;
  meetingAdvanceMinutes: number;
  preferenceGeneration: number;
  remoteDeliveryStatus: RemoteDeliveryStatus;
  meetings: Array<{
    reminderId: string;
    meetingId: string;
    title: string;
    startsAt: string | null;
    timeZone: string;
    scheduleRevision: number;
    status: 'SCHEDULED' | 'CANCELLED';
    triggerAt: string | null;
    route: string;
  }>;
}

function bool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function readReminderPreferences(db: DatabaseSync, memberId: string, remoteDeliveryStatus: RemoteDeliveryStatus = 'REMOTE_PENDING'): ReminderPreferenceSnapshot {
  const preference = db.prepare('SELECT reading_enabled, meeting_enabled, reading_time, meeting_advance_minutes, preference_generation FROM reminder_preferences WHERE member_id = ?').get(memberId) as
    | { reading_enabled: number; meeting_enabled: number; reading_time: string; meeting_advance_minutes: number; preference_generation: number }
    | undefined;
  const meetings = db.prepare(
    `SELECT meeting_id, meeting_title, starts_at, time_zone, schedule_revision, schedule_status
       FROM member_group_profiles
      WHERE member_id = ? AND meeting_id IS NOT NULL
      ORDER BY starts_at, rpg_id`,
  ).all(memberId) as Array<{
    meeting_id: string;
    meeting_title: string | null;
    starts_at: string | null;
    time_zone: string | null;
    schedule_revision: number | null;
    schedule_status: 'SCHEDULED' | 'CANCELLED' | null;
  }>;
  return {
    memberId,
    readingEnabled: bool(preference?.reading_enabled),
    meetingEnabled: bool(preference?.meeting_enabled),
    readingTime: preference?.reading_time ?? '08:00',
    meetingAdvanceMinutes: preference?.meeting_advance_minutes ?? 30,
    preferenceGeneration: preference?.preference_generation ?? 0,
    remoteDeliveryStatus,
    meetings: meetings.map((meeting) => ({
      reminderId: `meeting:${meeting.meeting_id}`,
      meetingId: meeting.meeting_id,
      title: meeting.meeting_title ?? 'RPG 聚會',
      startsAt: meeting.starts_at,
      timeZone: meeting.time_zone ?? 'Asia/Taipei',
      scheduleRevision: meeting.schedule_revision ?? 0,
      status: meeting.schedule_status ?? 'CANCELLED',
      triggerAt: meeting.starts_at ? new Date(Date.parse(meeting.starts_at) - (preference?.meeting_advance_minutes ?? 30) * 60_000).toISOString() : null,
      route: '/groups',
    })),
  };
}

export function saveReminderPreferences(db: DatabaseSync, memberId: string, input: { readingEnabled: boolean; meetingEnabled: boolean; readingTime?: string; meetingAdvanceMinutes?: number; preferenceGeneration?: number }, updatedAt = new Date().toISOString()): ReminderPreferenceSnapshot {
  const existing = db.prepare('SELECT reading_enabled, meeting_enabled, reading_time, meeting_advance_minutes, preference_generation FROM reminder_preferences WHERE member_id = ?').get(memberId) as { reading_enabled: number; meeting_enabled: number; reading_time: string; meeting_advance_minutes: number; preference_generation: number } | undefined;
  const preferenceGeneration = Number.isInteger(input.preferenceGeneration) ? Math.max(0, input.preferenceGeneration as number) : 0;
  if (existing && existing.preference_generation > preferenceGeneration) return readReminderPreferences(db, memberId);
  const readingTime = input.readingTime ?? existing?.reading_time ?? '08:00';
  const meetingAdvanceMinutes = input.meetingAdvanceMinutes ?? existing?.meeting_advance_minutes ?? 30;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(readingTime)) throw new Error('INVALID_READING_TIME');
  if (!Number.isInteger(meetingAdvanceMinutes) || meetingAdvanceMinutes < 0 || meetingAdvanceMinutes > 1440) throw new Error('INVALID_MEETING_ADVANCE');
  db.prepare(
    `INSERT INTO reminder_preferences (member_id, reading_enabled, meeting_enabled, reading_time, meeting_advance_minutes, preference_generation, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET reading_enabled = excluded.reading_enabled, meeting_enabled = excluded.meeting_enabled, reading_time = excluded.reading_time, meeting_advance_minutes = excluded.meeting_advance_minutes, preference_generation = excluded.preference_generation, updated_at = excluded.updated_at`,
  ).run(memberId, input.readingEnabled ? 1 : 0, input.meetingEnabled ? 1 : 0, readingTime, meetingAdvanceMinutes, preferenceGeneration, updatedAt);
  return readReminderPreferences(db, memberId);
}

export function registerDeviceDeliveryToken(db: DatabaseSync, input: { memberId: string; installationId: string; platform: 'ANDROID'; token: string; ownerGeneration?: number }, now = new Date().toISOString()): { accepted: boolean; bindingVersion: number; ownerGeneration: number } {
  const ownerGeneration = Number.isInteger(input.ownerGeneration) ? Math.max(0, input.ownerGeneration as number) : 0;
  const existing = db.prepare('SELECT owner_generation, binding_version FROM device_delivery_tokens WHERE installation_id = ?').get(input.installationId) as { owner_generation: number; binding_version: number } | undefined;
  if (existing && existing.owner_generation > ownerGeneration) return { accepted: false, bindingVersion: existing.binding_version, ownerGeneration: existing.owner_generation };
  const bindingVersion = (existing?.binding_version ?? 0) + 1;
  db.prepare(
    `INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, owner_generation, binding_version, revoked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(installation_id) DO UPDATE SET member_id = excluded.member_id, platform = excluded.platform, token = excluded.token, owner_generation = excluded.owner_generation, binding_version = excluded.binding_version, revoked_at = NULL, updated_at = excluded.updated_at`,
  ).run(input.installationId, input.memberId, input.platform, input.token, ownerGeneration, bindingVersion, now, now);
  return { accepted: true, bindingVersion, ownerGeneration };
}

export function revokeDeviceDeliveryToken(db: DatabaseSync, memberId: string, installationId: string, bindingVersion?: number, ownerGeneration?: number, now = new Date().toISOString()): boolean {
  const clauses = ['installation_id = ?', 'member_id = ?'];
  const params: Array<string | number> = [installationId, memberId];
  if (Number.isInteger(bindingVersion)) { clauses.push('binding_version = ?'); params.push(bindingVersion as number); }
  if (Number.isInteger(ownerGeneration)) { clauses.push('owner_generation = ?'); params.push(ownerGeneration as number); }
  const result = db.prepare(`UPDATE device_delivery_tokens SET revoked_at = ?, updated_at = ? WHERE ${clauses.join(' AND ')}`).run(now, now, ...params);
  return Number(result.changes) > 0;
}

export function currentMeeting(db: DatabaseSync, meetingId: string, memberId?: string): { member_id: string; schedule_revision: number | null; schedule_status: string | null; starts_at: string | null } | undefined {
  return db.prepare(
    `SELECT member_id, schedule_revision, schedule_status, starts_at
       FROM member_group_profiles
      WHERE meeting_id = ? ${memberId ? 'AND member_id = ?' : ''}
      ORDER BY COALESCE(schedule_revision, 0) DESC, last_updated_at DESC
      LIMIT 1`,
  ).get(...(memberId ? [meetingId, memberId] : [meetingId])) as { member_id: string; schedule_revision: number | null; schedule_status: string | null; starts_at: string | null } | undefined;
}

export function authorizeDeviceMeetingSnapshot(db: DatabaseSync, input: { installationId: string; token: string; meetingId: string }): AuthorizedDeviceMeetingSnapshot | null {
  const device = db.prepare(
    `SELECT member_id FROM device_delivery_tokens
      WHERE installation_id = ? AND token = ? AND platform = 'ANDROID' AND revoked_at IS NULL`,
  ).get(input.installationId, input.token) as { member_id: string } | undefined;
  if (!device) return null;
  const meeting = currentMeeting(db, input.meetingId, device.member_id);
  if (!meeting || meeting.schedule_revision === null || (meeting.schedule_status !== 'SCHEDULED' && meeting.schedule_status !== 'CANCELLED')) return null;
  return {
    memberId: device.member_id,
    meetingId: input.meetingId,
    scheduleRevision: meeting.schedule_revision,
    status: meeting.schedule_status,
  };
}

export function evaluateDueMeetingEvent(db: DatabaseSync, event: DueMeetingEvent, now = new Date()): DueMeetingResult {
  const base = { reminderId: event.reminderId, meetingId: event.meetingId, scheduleRevision: event.scheduleRevision };
  const nowMs = now.getTime();
  const triggerMs = Date.parse(event.triggerAt);
  const expiresMs = Date.parse(event.expiresAt);
  if (!Number.isFinite(triggerMs) || !Number.isFinite(expiresMs) || expiresMs <= nowMs) return { ...base, decision: 'DROP_EXPIRED' };
  if (triggerMs > nowMs) return { ...base, decision: 'NOT_DUE' };
  const current = currentMeeting(db, event.meetingId, event.memberId);
  if (!current || current.schedule_revision === null || !current.schedule_status) return { ...base, decision: 'DROP_UNKNOWN' };
  if (current.schedule_status === 'CANCELLED') return { ...base, decision: 'DROP_CANCELLED', latestRevision: current.schedule_revision, latestStatus: current.schedule_status };
  if (current.schedule_revision !== event.scheduleRevision) return { ...base, decision: 'DROP_STALE', latestRevision: current.schedule_revision, latestStatus: current.schedule_status };
  if (event.reminderId !== `meeting:${event.meetingId}:${event.scheduleRevision}` || current.member_id !== event.memberId) return { ...base, decision: 'DROP_UNKNOWN', latestRevision: current.schedule_revision, latestStatus: current.schedule_status };
  const deliveryId = `${event.memberId}:${event.reminderId}`;
  const existing = db.prepare('SELECT status FROM reminder_deliveries WHERE delivery_id = ?').get(deliveryId) as { status: string } | undefined;
  if (existing?.status === 'SENT') return { ...base, decision: 'ALREADY_SENT', latestRevision: current.schedule_revision, latestStatus: current.schedule_status };
  if (existing?.status === 'CLAIMED' || existing?.status === 'UNKNOWN') return { ...base, decision: 'UNKNOWN_RECONCILE', latestRevision: current.schedule_revision, latestStatus: current.schedule_status };
  const tokenRow = db.prepare(
    `SELECT token FROM device_delivery_tokens
      WHERE member_id = ? AND platform = 'ANDROID' AND revoked_at IS NULL
      ORDER BY updated_at DESC LIMIT 1`,
  ).get(event.memberId) as { token: string } | undefined;
  if (!tokenRow) return { ...base, decision: 'DROP_UNKNOWN', latestRevision: current.schedule_revision, latestStatus: current.schedule_status };
  return {
    ...base,
    decision: 'SEND',
    latestRevision: current.schedule_revision,
    latestStatus: current.schedule_status,
    token: tokenRow.token,
    payload: { event: 'MEETING_REMINDER', reminderId: event.reminderId, meetingId: event.meetingId, scheduleRevision: event.scheduleRevision },
  };
}

export async function sendDueMeetingEvent(
  db: DatabaseSync,
  event: DueMeetingEvent,
  send: (token: string, payload: { event: 'MEETING_REMINDER'; reminderId: string; meetingId: string; scheduleRevision: number }) => Promise<void | { messageId?: string | null }>,
  now = new Date(),
): Promise<DueMeetingResult> {
  const evaluated = evaluateDueMeetingEvent(db, event, now);
  if (evaluated.decision !== 'SEND' || !evaluated.token || !evaluated.payload) return evaluated;
  const deliveryId = `${event.memberId}:${event.reminderId}`;
  const claim = db.prepare(
    `INSERT OR IGNORE INTO reminder_deliveries (delivery_id, reminder_id, member_id, meeting_id, schedule_revision, trigger_at, expires_at, status, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'CLAIMED', ?)`,
  ).run(deliveryId, event.reminderId, event.memberId, event.meetingId, event.scheduleRevision, event.triggerAt, event.expiresAt, now.toISOString());
  if (Number(claim.changes) === 0) {
    const existing = db.prepare('SELECT status FROM reminder_deliveries WHERE delivery_id = ?').get(deliveryId) as { status: string } | undefined;
    return { ...evaluated, decision: existing?.status === 'SENT' ? 'ALREADY_SENT' : 'UNKNOWN_RECONCILE' };
  }
  try {
    const providerResult = await send(evaluated.token, evaluated.payload);
    const providerMessageId = providerResult && typeof providerResult.messageId === 'string' ? providerResult.messageId : null;
    db.prepare(
      `UPDATE reminder_deliveries SET status = 'SENT', sent_at = ?, provider_message_id = ?, last_error = NULL WHERE delivery_id = ?`,
    ).run(now.toISOString(), providerMessageId, deliveryId);
  } catch (error) {
    db.prepare(`UPDATE reminder_deliveries SET status = 'UNKNOWN', last_error = ? WHERE delivery_id = ?`).run(error instanceof Error ? error.message.slice(0, 500) : 'DELIVERY_UNKNOWN', deliveryId);
    return { ...evaluated, decision: 'UNKNOWN_RECONCILE' };
  }
  return evaluated;
}
