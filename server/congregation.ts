import type { DatabaseSync } from 'node:sqlite';

/**
 * 青少/主堂 (維護者 2026-10-17). Every member belongs to one; it decides which announcements open first, which
 * prizes they see and which group number they are part of. Members from before the split are 青少 and are never
 * asked; a member with no row has not chosen yet (the app asks once) and counts as 青少 until then.
 * Account deletion clears the row (server/accountDeletion.ts).
 */
export type Congregation = 'youth' | 'main';

export function isCongregation(value: unknown): value is Congregation {
  return value === 'youth' || value === 'main';
}

export function ensureCongregationSchema(db: DatabaseSync, nowIso = new Date().toISOString()): void {
  const existed = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'member_affiliations'").get());
  db.exec(`CREATE TABLE IF NOT EXISTS member_affiliations (
    member_id TEXT PRIMARY KEY,
    congregation TEXT NOT NULL CHECK(congregation IN ('youth', 'main')),
    chosen_at TEXT
  )`);
  // Only when the table is new: everyone already here was a 青少 member before 主堂 could join.
  if (!existed) db.prepare("INSERT OR IGNORE INTO member_affiliations(member_id, congregation, chosen_at) SELECT id, 'youth', ? FROM members").run(nowIso);
}

/** The member's own choice, or null when they have not chosen yet. */
export function chosenCongregation(db: DatabaseSync, memberId: string): Congregation | null {
  const row = db.prepare('SELECT congregation FROM member_affiliations WHERE member_id = ?').get(memberId) as { congregation: string } | undefined;
  return row && isCongregation(row.congregation) ? row.congregation : null;
}

/** Where the member counts and what they see; not chosen yet counts as 青少. */
export function congregationOf(db: DatabaseSync, memberId: string): Congregation {
  return chosenCongregation(db, memberId) ?? 'youth';
}

export function setCongregation(db: DatabaseSync, memberId: string, congregation: Congregation, nowIso: string): Congregation {
  db.prepare(`INSERT INTO member_affiliations(member_id, congregation, chosen_at) VALUES (?, ?, ?)
    ON CONFLICT(member_id) DO UPDATE SET congregation = excluded.congregation, chosen_at = excluded.chosen_at`).run(memberId, congregation, nowIso);
  return congregation;
}

/** SQL condition on a members alias: who counts in a group number for this congregation. */
export function countsFor(scope: Congregation, memberAlias: string): string {
  // 主堂 is the whole church, 青少 included; 青少 leaves out the members who chose 主堂.
  return scope === 'main' ? '1 = 1'
    : `NOT EXISTS (SELECT 1 FROM member_affiliations a WHERE a.member_id = ${memberAlias}.id AND a.congregation = 'main')`;
}
