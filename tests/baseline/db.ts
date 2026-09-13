import { DatabaseSync } from 'node:sqlite';
import { LOCAL_SCHEMA } from '../../src/storage/schema';
import { buildCompletionOperationFingerprint } from './operationFingerprint';

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
}

export interface ServerDatabase {
  db: DatabaseSync;
  close: () => void;
}

export function createDatabase(options: { filename?: string; members?: ServerMember[]; groupProfiles?: ServerGroupProfile[] } = {}): ServerDatabase {
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
  `);
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
  const insert = db.prepare(
    'INSERT OR REPLACE INTO members (id, display_name, group_id) VALUES (?, ?, ?)',
  );
  for (const member of options.members ?? []) insert.run(member.id, member.displayName, member.groupId);
  const insertGroupProfile = db.prepare(
    `INSERT OR REPLACE INTO member_group_profiles
      (member_id, group_id, group_name, rpg_id, rpg_name, open_chat_url, call_url, call_provider, call_scope, link_status, link_revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  );
  return { db, close: () => db.close() };
}
