import { DatabaseSync } from 'node:sqlite';
import { ensureMobileSessionSchema } from './mobileSessions';
import { ensureMeetingSchema } from './meetingSchedules';
import { LOCAL_SCHEMA } from '../src/storage/schema';
import { buildCompletionOperationFingerprint } from './operationFingerprint';
import { defaultReadingDays, ensureGamificationSchema, seedReadingDays, type ReadingDaySeed } from './gamification';

export interface ServerMember {
  id: string;
  displayName: string;
  groupId: string;
}

export interface ServerGroupProfile {
  memberId: string;
  groupId: string;
  groupName: string;
  rpgId: string;
  rpgName: string;
  openChatUrl?: string | null;
  callUrl?: string | null;
  callProvider?: 'meet' | 'zoom' | null;
  callScope?: 'TEST_ONLY' | 'APPROVED' | null;
  linkStatus: 'READY' | 'PENDING_UI_VERIFICATION';
  linkRevision?: number;
  updatedAt?: string;
  meetingId?: string | null;
  meetingTitle?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  timeZone?: string | null;
  organizerLabel?: string | null;
  scheduleRevision?: number | null;
  scheduleStatus?: 'SCHEDULED' | 'CANCELLED' | null;
  standingRoom?: boolean;
  lastUpdatedAt?: string | null;
}

export interface ServerDatabase {
  db: DatabaseSync;
  close: () => void;
}

export function createDatabase(options: { filename?: string; members?: ServerMember[]; groupProfiles?: ServerGroupProfile[]; readingDays?: ReadingDaySeed[] } = {}): ServerDatabase {
  const db = new DatabaseSync(options.filename ?? ':memory:');
  db.exec(`
    ${LOCAL_SCHEMA}
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      group_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identity_bindings (
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      member_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, subject),
      UNIQUE (provider, member_id)
    );
    CREATE TABLE IF NOT EXISTS member_invites (
      invite_id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      member_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      group_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_group_profiles (
      member_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      rpg_id TEXT NOT NULL,
      rpg_name TEXT NOT NULL,
      open_chat_url TEXT,
      call_url TEXT,
      call_provider TEXT,
      call_scope TEXT,
      link_status TEXT NOT NULL,
      link_revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      meeting_id TEXT,
      meeting_title TEXT,
      starts_at TEXT,
      ends_at TEXT,
      time_zone TEXT,
      organizer_label TEXT,
      schedule_revision INTEGER,
      schedule_status TEXT,
      standing_room INTEGER NOT NULL DEFAULT 0,
      last_updated_at TEXT,
      PRIMARY KEY (member_id, rpg_id)
    );
    CREATE TABLE IF NOT EXISTS operations (
      operation_id TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      command_fingerprint TEXT
    );
    CREATE TABLE IF NOT EXISTS point_events (
      event_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      completion_key TEXT NOT NULL,
      status TEXT NOT NULL,
      policy_version TEXT NOT NULL
    );
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
    CREATE TABLE IF NOT EXISTS reminder_deliveries (
      delivery_id TEXT PRIMARY KEY,
      reminder_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      schedule_revision INTEGER NOT NULL,
      trigger_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL,
      sent_at TEXT,
      claimed_at TEXT,
      provider_message_id TEXT,
      last_error TEXT
    );
  `);
  const reminderPreferenceColumns = db.prepare('PRAGMA table_info(reminder_preferences)').all() as Array<{ name: string }>;
  const reminderPreferenceNames = new Set(reminderPreferenceColumns.map((column) => column.name));
  if (!reminderPreferenceNames.has('reading_time')) db.exec("ALTER TABLE reminder_preferences ADD COLUMN reading_time TEXT NOT NULL DEFAULT '08:00'");
  if (!reminderPreferenceNames.has('meeting_advance_minutes')) db.exec('ALTER TABLE reminder_preferences ADD COLUMN meeting_advance_minutes INTEGER NOT NULL DEFAULT 30');
  if (!reminderPreferenceNames.has('preference_generation')) db.exec('ALTER TABLE reminder_preferences ADD COLUMN preference_generation INTEGER NOT NULL DEFAULT 0');
  const deliveryColumns = db.prepare('PRAGMA table_info(reminder_deliveries)').all() as Array<{ name: string }>;
  const deliveryNames = new Set(deliveryColumns.map((column) => column.name));
  if (!deliveryNames.has('claimed_at')) db.exec('ALTER TABLE reminder_deliveries ADD COLUMN claimed_at TEXT');
  if (!deliveryNames.has('provider_message_id')) db.exec('ALTER TABLE reminder_deliveries ADD COLUMN provider_message_id TEXT');
  if (!deliveryNames.has('last_error')) db.exec('ALTER TABLE reminder_deliveries ADD COLUMN last_error TEXT');
  const tokenColumns = db.prepare('PRAGMA table_info(device_delivery_tokens)').all() as Array<{ name: string }>;
  const tokenNames = new Set(tokenColumns.map((column) => column.name));
  if (!tokenNames.has('owner_generation')) db.exec('ALTER TABLE device_delivery_tokens ADD COLUMN owner_generation INTEGER NOT NULL DEFAULT 0');
  if (!tokenNames.has('binding_version')) db.exec('ALTER TABLE device_delivery_tokens ADD COLUMN binding_version INTEGER NOT NULL DEFAULT 0');
  const profileColumns = db.prepare('PRAGMA table_info(member_group_profiles)').all() as Array<{ name: string }>;
  const profileColumnNames = new Set(profileColumns.map((column) => column.name));
  const profileAdditions: Record<string, string> = {
    meeting_id: 'TEXT',
    meeting_title: 'TEXT',
    starts_at: 'TEXT',
    ends_at: 'TEXT',
    time_zone: 'TEXT',
    organizer_label: 'TEXT',
    schedule_revision: 'INTEGER',
    schedule_status: 'TEXT',
    standing_room: 'INTEGER NOT NULL DEFAULT 0',
    last_updated_at: 'TEXT',
  };
  for (const [name, definition] of Object.entries(profileAdditions)) {
    if (!profileColumnNames.has(name)) db.exec(`ALTER TABLE member_group_profiles ADD COLUMN ${name} ${definition}`);
  }
  const operationColumns = db.prepare('PRAGMA table_info(operations)').all() as Array<{ name: string }>;
  if (!operationColumns.some((column) => column.name === 'command_fingerprint')) {
    db.exec('ALTER TABLE operations ADD COLUMN command_fingerprint TEXT');
  }
  const legacyOperations = db
    .prepare('SELECT operation_id, response_json FROM operations WHERE command_fingerprint IS NULL')
    .all() as Array<{ operation_id: string; response_json: string }>;
  const backfillOperation = db.prepare('UPDATE operations SET command_fingerprint = ? WHERE operation_id = ?');
  for (const operation of legacyOperations) {
    try {
      const response = JSON.parse(operation.response_json) as Record<string, unknown>;
      const revision = Number(response.revision);
      const memberId = typeof response.memberId === 'string' ? response.memberId : null;
      const planId = typeof response.planId === 'string' ? response.planId : null;
      const taskDate = typeof response.taskDate === 'string' ? response.taskDate : null;
      const status = response.status;
      if (memberId && planId && taskDate && Number.isInteger(revision) && revision > 0 && (status === 'UNREPORTED' || status === 'NOT_COMPLETED' || status === 'COMPLETED')) {
        backfillOperation.run(
          buildCompletionOperationFingerprint({ memberId, planId, taskDate, status }),
          operation.operation_id,
        );
      }
    } catch {
      // Leave malformed legacy rows unverified; routes reject their replay.
    }
  }
  ensureMeetingSchema(db);
  ensureMobileSessionSchema(db);
  ensureGamificationSchema(db);
  const readingDayCount = Number((db.prepare('SELECT COUNT(*) AS count FROM reading_days').get() as { count: number }).count);
  if (readingDayCount === 0) seedReadingDays(db, options.readingDays ?? defaultReadingDays());
  const insert = db.prepare(
    'INSERT OR REPLACE INTO members (id, display_name, group_id) VALUES (?, ?, ?)',
  );
  for (const member of options.members ?? []) insert.run(member.id, member.displayName, member.groupId);
  const insertGroupProfile = db.prepare(
    `INSERT OR REPLACE INTO member_group_profiles
      (member_id, group_id, group_name, rpg_id, rpg_name, open_chat_url, call_url, call_provider, call_scope, link_status, link_revision, updated_at, meeting_id, meeting_title, starts_at, ends_at, time_zone, organizer_label, schedule_revision, schedule_status, standing_room, last_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const profile of options.groupProfiles ?? []) insertGroupProfile.run(
    profile.memberId,
    profile.groupId,
    profile.groupName,
    profile.rpgId,
    profile.rpgName,
    profile.openChatUrl ?? null,
    profile.callUrl ?? null,
    profile.callProvider ?? null,
    profile.callScope ?? null,
    profile.linkStatus,
    profile.linkRevision ?? 1,
    profile.updatedAt ?? new Date().toISOString(),
    profile.meetingId ?? null,
    profile.meetingTitle ?? null,
    profile.startsAt ?? null,
    profile.endsAt ?? null,
    profile.timeZone ?? null,
    profile.organizerLabel ?? null,
    profile.scheduleRevision ?? null,
    profile.scheduleStatus ?? null,
    profile.standingRoom ? 1 : 0,
    profile.lastUpdatedAt ?? profile.updatedAt ?? new Date().toISOString(),
  );
  return { db, close: () => db.close() };
}
