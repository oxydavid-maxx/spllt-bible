import type { DatabaseSync } from 'node:sqlite';

/**
 * 管理者 checked in the prize sheet (光佑 2026-10-21: 「截圖所示，看能不能就標註在這裏面？」「全部一樣」). The 管理者
 * column on 青少讀經統計 and 主堂讀經統計 (tools/rewards/reward-sheet.gs) sends every name on those pages with its
 * check. A checked person is an administrator with exactly the rights of the ones in the private settings
 * (QINGMU_ADMIN_GOOGLE_SUBJECTS, QINGMU_ADMIN_MEMBER_IDS): 全體 (管理), 後台規則與文件 and the OTA preview switch;
 * unchecking revokes it. The person is found by their sheet label, so a Google or an Apple sign-in is the same.
 *
 * The private settings stay the owner's: the sheet never adds or removes one of those administrators, so unchecking
 * the owner changes nothing, and the sheet shows him checked. Anyone who can edit the sheet can name administrators
 * (光佑 accepted this). Who may push is unchanged: only the owner's script (server/routes.ts integrationAuthorized).
 *
 * The sheet is the record, like the rest of it, but only for the names a push carries: a push without the column (an
 * older script, or a page still in the old layout) changes nothing, and a person not on the pages keeps their state.
 * Every grant and revoke is written to sheet_admin_changes (member, the label they had, which way, when); account
 * deletion clears both tables (server/accountDeletion.ts).
 */
export interface SheetAdminMark { name: string; admin: boolean }

const MAX_MARKS = 10_000;
const MAX_TEXT = 100;

export function ensureSheetAdminSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sheet_admins (
      member_id TEXT PRIMARY KEY,
      granted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sheet_admin_changes (
      change_id INTEGER PRIMARY KEY,
      member_id TEXT NOT NULL,
      label TEXT NOT NULL,
      change TEXT NOT NULL CHECK(change IN ('grant', 'revoke')),
      changed_at TEXT NOT NULL
    );
  `);
}

/** The push's 管理者 list: undefined when it has none, null when its shape is wrong (the whole push is refused). */
export function readSheetAdminMarks(value: unknown): SheetAdminMark[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_MARKS) return null;
  const marks: SheetAdminMark[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { name, admin } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof admin !== 'boolean') return null;
    marks.push({ name: name.trim().slice(0, MAX_TEXT), admin });
  }
  return marks;
}

/**
 * Applies the checks inside the sheet push's transaction. `labels` maps a sheet label to its member. A name the app
 * does not know is ignored; a name checked one way and unchecked another is left as it was.
 */
export function applySheetAdminMarks(db: DatabaseSync, marks: readonly SheetAdminMark[], labels: ReadonlyMap<string, string>, settingsAdminIds: readonly string[], nowIso: string): void {
  const wanted = new Map<string, { label: string; admin: boolean | null }>();
  for (const mark of marks) {
    const memberId = labels.get(mark.name);
    if (!memberId || settingsAdminIds.includes(memberId)) continue;
    const prior = wanted.get(memberId);
    wanted.set(memberId, { label: mark.name, admin: prior === undefined || prior.admin === mark.admin ? mark.admin : null });
  }
  const current = new Set(sheetAdminMemberIds(db));
  const grant = db.prepare('INSERT INTO sheet_admins(member_id, granted_at) VALUES(?, ?)');
  const revoke = db.prepare('DELETE FROM sheet_admins WHERE member_id = ?');
  const record = db.prepare('INSERT INTO sheet_admin_changes(member_id, label, change, changed_at) VALUES(?, ?, ?, ?)');
  for (const [memberId, { label, admin }] of wanted) {
    if (admin === null || admin === current.has(memberId)) continue;
    if (admin) grant.run(memberId, nowIso); else revoke.run(memberId);
    record.run(memberId, label, admin ? 'grant' : 'revoke', nowIso);
  }
}

export function sheetAdminMemberIds(db: DatabaseSync): string[] {
  return (db.prepare('SELECT member_id FROM sheet_admins ORDER BY member_id').all() as Array<{ member_id: string }>).map((row) => row.member_id);
}
