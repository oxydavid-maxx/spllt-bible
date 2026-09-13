import type { DatabaseSync } from 'node:sqlite';
import { readMeetingSchedules } from './meetingSchedules';
export type RemoteReminderStatus = 'REMOTE_PENDING' | 'REMOTE_READY';

// Preference/device storage remains separate from meeting authority and transport.
export const REMINDER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reminder_preferences (
    member_id TEXT PRIMARY KEY,
    reading_enabled INTEGER NOT NULL DEFAULT 0,
    meeting_enabled INTEGER NOT NULL DEFAULT 0,
    reading_time TEXT NOT NULL DEFAULT '08:00',
    meeting_advance_minutes INTEGER NOT NULL DEFAULT 30,
    preference_generation INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS device_delivery_tokens (
    installation_id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    token TEXT NOT NULL,
    owner_generation INTEGER NOT NULL DEFAULT 0,
    binding_version INTEGER NOT NULL DEFAULT 0,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

type PreferenceRow = {
  reading_enabled: number; meeting_enabled: number; reading_time: string;
  meeting_advance_minutes: number; preference_generation: number;
};

export function readReminderPreferences(db: DatabaseSync, memberId: string, remoteStatus: RemoteReminderStatus = 'REMOTE_PENDING') {
  const row = db.prepare('SELECT reading_enabled, meeting_enabled, reading_time, meeting_advance_minutes, preference_generation FROM reminder_preferences WHERE member_id = ?').get(memberId) as PreferenceRow | undefined;
  return {
    memberId,
    readingEnabled: row?.reading_enabled === 1,
    meetingEnabled: row?.meeting_enabled === 1,
    readingTime: row?.reading_time ?? '08:00',
    meetingAdvanceMinutes: row?.meeting_advance_minutes ?? 30,
    preferenceGeneration: row?.preference_generation ?? 0,
    remoteDeliveryStatus: remoteStatus,
    meetings: readMeetingSchedules(db, memberId, row?.meeting_advance_minutes ?? 30),
  };
}

export function saveReminderPreferences(db: DatabaseSync, memberId: string, input: {
  readingEnabled: boolean; meetingEnabled: boolean; readingTime: string;
  meetingAdvanceMinutes: number; preferenceGeneration: number;
}, remoteStatus: RemoteReminderStatus = 'REMOTE_PENDING') {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.readingTime)) throw new Error('INVALID_READING_TIME');
  if (!Number.isInteger(input.meetingAdvanceMinutes) || input.meetingAdvanceMinutes < 0 || input.meetingAdvanceMinutes > 1440) throw new Error('INVALID_MEETING_ADVANCE');
  if (!Number.isSafeInteger(input.preferenceGeneration) || input.preferenceGeneration < 0) throw new Error('INVALID_PREFERENCE_GENERATION');
  db.prepare(`
    INSERT INTO reminder_preferences (member_id, reading_enabled, meeting_enabled, reading_time, meeting_advance_minutes, preference_generation, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id) DO UPDATE SET
      reading_enabled = excluded.reading_enabled, meeting_enabled = excluded.meeting_enabled,
      reading_time = excluded.reading_time, meeting_advance_minutes = excluded.meeting_advance_minutes,
      preference_generation = excluded.preference_generation, updated_at = excluded.updated_at
    WHERE excluded.preference_generation >= reminder_preferences.preference_generation
  `).run(memberId, input.readingEnabled ? 1 : 0, input.meetingEnabled ? 1 : 0, input.readingTime, input.meetingAdvanceMinutes, input.preferenceGeneration, new Date().toISOString());
  return readReminderPreferences(db, memberId, remoteStatus);
}

export function registerDeviceDeliveryToken(db: DatabaseSync, input: {
  memberId: string; installationId: string; token: string; ownerGeneration: number;
}) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO device_delivery_tokens (installation_id, member_id, platform, token, owner_generation, binding_version, revoked_at, created_at, updated_at)
    VALUES (?, ?, 'ANDROID', ?, ?, 1, NULL, ?, ?)
    ON CONFLICT(installation_id) DO UPDATE SET member_id = excluded.member_id,
      token = excluded.token, owner_generation = excluded.owner_generation,
      binding_version = device_delivery_tokens.binding_version + 1,
      revoked_at = NULL, updated_at = excluded.updated_at
    WHERE excluded.owner_generation > device_delivery_tokens.owner_generation
       OR (excluded.owner_generation = device_delivery_tokens.owner_generation
           AND excluded.member_id = device_delivery_tokens.member_id)
  `).run(input.installationId, input.memberId, input.token, input.ownerGeneration, now, now);
  const binding = db.prepare('SELECT binding_version, owner_generation FROM device_delivery_tokens WHERE installation_id = ?').get(input.installationId) as { binding_version: number; owner_generation: number };
  return { registered: Number(result.changes) > 0, bindingVersion: binding.binding_version, ownerGeneration: binding.owner_generation, remoteDeliveryStatus: 'REMOTE_PENDING' as const };
}

export function revokeDeviceDeliveryToken(db: DatabaseSync, memberId: string, installationId: string, bindingVersion?: number, ownerGeneration?: number): boolean {
  const clauses = ['installation_id = ?', 'member_id = ?'];
  const params: Array<string | number> = [installationId, memberId];
  if (bindingVersion !== undefined) { clauses.push('binding_version = ?'); params.push(bindingVersion); }
  if (ownerGeneration !== undefined) { clauses.push('owner_generation = ?'); params.push(ownerGeneration); }
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE device_delivery_tokens SET revoked_at = ?, updated_at = ? WHERE ${clauses.join(' AND ')}`).run(now, now, ...params);
  return Number(result.changes) > 0;
}
