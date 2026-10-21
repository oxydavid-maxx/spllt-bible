import type { DatabaseSync } from 'node:sqlite';

// Member-owned rows, including dormant legacy features; no public content is deleted.
const OWNERS: Record<string, readonly string[]> = {
  identity_bindings: ['member_id'], member_invites: ['member_id'], member_group_profiles: ['member_id'],
  completions: ['member_id'], point_events: ['member_id'], reminder_preferences: ['member_id'],
  device_delivery_tokens: ['member_id'], reminder_deliveries: ['member_id'], auth_sessions: ['member_id'],
  apple_refresh_tokens: ['member_id'], daily_point_entitlements: ['member_id'], wallet_entries: ['member_id'],
  reward_targets: ['member_id'], redemptions: ['member_id'], friend_tokens: ['owner_member_id'],
  friendships: ['member_low', 'member_high'], mutation_receipts: ['actor_member_id'],
  journal_entries: ['member_id'], devotion_completions: ['member_id'], event_registrations: ['member_id'],
  client_installs: ['member_id'], sheet_admins: ['member_id'], sheet_admin_changes: ['member_id'],
};
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** All local server data is removed atomically. A failed statement never leaves a half-deleted account. */
export function deleteMemberAccount(db: DatabaseSync, memberId: string): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
    if (tables.has('reward_nominations')) {
      for (const child of ['reward_nomination_votes', 'reward_nomination_assists']) if (tables.has(child)) {
        db.prepare(`DELETE FROM ${quote(child)} WHERE nomination_id IN (SELECT nomination_id FROM reward_nominations WHERE created_by=?)`).run(memberId);
      }
      db.prepare('DELETE FROM reward_nominations WHERE created_by=?').run(memberId);
      db.prepare('UPDATE reward_nominations SET decided_by=NULL WHERE decided_by=?').run(memberId);
      db.prepare('DELETE FROM reward_nomination_votes WHERE member_id=?').run(memberId);
      db.prepare("UPDATE reward_nomination_rounds SET opened_by='deleted' WHERE opened_by=?").run(memberId);
    }
    for (const [table, columns] of Object.entries(OWNERS)) if (tables.has(table)) {
      db.prepare(`DELETE FROM ${quote(table)} WHERE ${columns.map(column => `${quote(column)}=?`).join(' OR ')}`).run(...columns.map(() => memberId));
    }
    // Future membership/affiliation tables use the member_id ownership convention too.
    // A column on members (e.g. congregation) disappears with the entire member row below.
    for (const table of tables) {
      if (table in OWNERS || table.startsWith('sqlite_')) continue;
      const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[];
      if (columns.some(column => column.name === 'member_id')) db.prepare(`DELETE FROM ${quote(table)} WHERE member_id=?`).run(memberId);
    }
    // Preserve other members' financial rows, but remove the deleted administrator's attribution.
    db.prepare("UPDATE redemptions SET confirmed_by='deleted' WHERE confirmed_by=?").run(memberId);
    db.prepare('UPDATE redemptions SET reversed_by=NULL WHERE reversed_by=?').run(memberId);
    db.prepare("UPDATE rewards SET updated_by='deleted' WHERE updated_by=?").run(memberId);
    // Historical response caches can contain nested member IDs/names. Parse exact string values;
    // substring matching would remove unrelated IDs such as member:10 for member:1.
    const contains = (value: unknown): boolean => value === memberId || (Array.isArray(value) ? value.some(contains) : value !== null && typeof value === 'object' && Object.values(value).some(contains));
    for (const [table, id, fields] of [
      ['operations', 'operation_id', ['response_json', 'command_fingerprint']],
      ['mutation_receipts', 'operation_id', ['result_json']],
      ['migration_receipts', 'migration_id', ['result_json']],
    ] as const) {
      for (const row of db.prepare(`SELECT rowid AS _row, ${quote(id)}, ${fields.map(quote).join(',')} FROM ${quote(table)}`).all()) {
        if (fields.some(field => { try { return contains(JSON.parse(String(row[field]))); } catch { return false; } })) db.prepare(`DELETE FROM ${quote(table)} WHERE rowid=?`).run(row._row);
      }
    }
    db.prepare('DELETE FROM members WHERE id=?').run(memberId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
