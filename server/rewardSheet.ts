import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { congregationOf, type Congregation } from './congregation';
import { applySheetAdminMarks, ensureSheetAdminSchema, readSheetAdminMarks, type SheetAdminMark } from './sheetAdmins';

/**
 * 獎品與兌換 live in one Google Sheet (維護者 2026-10-17), tabs 青少獎品, 青少兌換, 主堂獎品, 主堂兌換. An Apps Script
 * there (tools/rewards/reward-sheet.gs) sends the tabs whenever someone edits them and every 15 minutes. The sheet
 * is the record: each push replaces what that side sent before. Redeemable points are the reading points minus
 * every redemption row, so deleting a row gives the points back; there is no other rule hidden in the sheet.
 * Gifts are handed over on paper and the 同工 writes the row afterwards; the app no longer redeems.
 *
 * Names in the 兌換 tabs come from a dropdown this module fills: one label per member, given once and kept, so a
 * second 小明 joining later becomes 「小明 (2)」 and never takes over the first one's rows.
 *
 * The same labels name people in the 管理者 column of the 讀經統計 tabs (光佑 2026-10-21, server/sheetAdmins.ts).
 */
export interface RewardSheetReward { row: number; name: string; points: unknown; listed: boolean }
export interface RewardSheetRedemption { row: number; date: string; name: string; reward: string; points: unknown }
export interface RewardSheetSide { rewards: RewardSheetReward[]; redemptions: RewardSheetRedemption[] }
export type RewardSheetPush = Partial<Record<Congregation, RewardSheetSide>> & {
  /** Every name on the 讀經統計 tabs with its 管理者 check; absent from an older script, and then nothing changes. */
  admins?: SheetAdminMark[];
};
export interface RewardSheetRejection { side: Congregation; tab: 'rewards' | 'redemptions'; row: number; field: 'name' | 'points' | 'date' | 'reward' | 'duplicate' }
export interface RewardSheetResult {
  labels: Record<Congregation, string[]>;
  rejected: RewardSheetRejection[];
  /** The prizes set up in the app before the sheet, for the script to copy into 青少獎品 when it creates the sheet. */
  legacyRewards: Array<{ name: string; points: number }>;
}
export interface ListedReward { rewardId: string; name: string; costPoints: number; active: true; revision: number }

const SIDES: readonly Congregation[] = ['youth', 'main'];
const MAX_ROWS = 5000;
const MAX_TEXT = 100;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function ensureRewardSheetSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reward_sheet_sync (
      congregation TEXT PRIMARY KEY CHECK(congregation IN ('youth', 'main')),
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sheet_redemptions (
      congregation TEXT NOT NULL CHECK(congregation IN ('youth', 'main')),
      row_number INTEGER NOT NULL,
      member_id TEXT NOT NULL,
      reward_name TEXT NOT NULL,
      points INTEGER NOT NULL CHECK(points > 0),
      redeemed_on TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(congregation, row_number)
    );
    CREATE INDEX IF NOT EXISTS sheet_redemptions_member ON sheet_redemptions(member_id);
    CREATE TABLE IF NOT EXISTS member_sheet_labels (
      member_id TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE
    );
  `);
  ensureSheetAdminSchema(db);
  // A prize from the sheet belongs to one side; the ones set up in the app before have none.
  const columns = db.prepare('PRAGMA table_info(rewards)').all() as Array<{ name: string }>;
  if (columns.length && !columns.some((column) => column.name === 'congregation')) db.exec('ALTER TABLE rewards ADD COLUMN congregation TEXT');
}

/** Points taken off by the sheet's redemption rows. */
export function sheetRedeemedPoints(db: DatabaseSync, memberId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(points), 0) AS total FROM sheet_redemptions WHERE member_id = ?').get(memberId) as { total: number };
  return Number(row.total) || 0;
}

function synced(db: DatabaseSync, side: Congregation): boolean {
  return Boolean(db.prepare('SELECT 1 FROM reward_sheet_sync WHERE congregation = ?').get(side));
}

/** The prizes a member of this side can aim at: the sheet's listed ones, or for 青少 the in-app list until the sheet first arrives. */
export function listRewards(db: DatabaseSync, side: Congregation): ListedReward[] {
  const rows = synced(db, side)
    ? db.prepare('SELECT reward_id, name, cost_points, revision FROM rewards WHERE active = 1 AND congregation = ? ORDER BY cost_points, name, reward_id').all(side)
    : side === 'youth'
      ? db.prepare('SELECT reward_id, name, cost_points, revision FROM rewards WHERE active = 1 AND congregation IS NULL ORDER BY cost_points, name, reward_id').all()
      : [];
  return (rows as Array<{ reward_id: string; name: string; cost_points: number; revision: number }>).map((row) => ({ rewardId: row.reward_id, name: row.name, costPoints: row.cost_points, active: true, revision: row.revision }));
}

/**
 * Whether a prize belongs to this side: the sheet's own tab, or for 青少 a prize from the in-app list before the
 * sheet. A member who changes sides keeps their target row; it shows again if they come back (維護者 2026-10-20).
 */
export function rewardOnSide(db: DatabaseSync, rewardId: string, side: Congregation): boolean {
  const row = db.prepare('SELECT congregation FROM rewards WHERE reward_id = ?').get(rewardId) as { congregation: string | null } | undefined;
  return Boolean(row) && (row!.congregation === side || (row!.congregation === null && side === 'youth'));
}

/** The member's own rows, shaped like the app's 領取紀錄 entries; the date is noon in Taipei. */
export function sheetRedemptionsFor(db: DatabaseSync, memberId: string): Array<Record<string, unknown>> {
  return (db.prepare('SELECT congregation, row_number, reward_name, points, redeemed_on FROM sheet_redemptions WHERE member_id = ? ORDER BY redeemed_on DESC, congregation, row_number').all(memberId) as Array<{ congregation: string; row_number: number; reward_name: string; points: number; redeemed_on: string }>)
    .map((row) => ({
      redemptionId: `sheet:${row.congregation}:${row.row_number}`, memberId, rewardId: 'sheet', rewardName: row.reward_name,
      costPoints: row.points, status: 'COMPLETED', confirmedAt: Date.parse(`${row.redeemed_on}T12:00:00+08:00`),
    }));
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '');
const positivePoints = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null);
const rowNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null);

/** Reads the body the script sends; null when its shape is wrong (a single bad cell is a rejection, not this). */
export function readRewardSheetPush(value: unknown): RewardSheetPush | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const push: RewardSheetPush = {};
  const admins = readSheetAdminMarks((value as Record<string, unknown>).admins);
  if (admins === null) return null;
  if (admins) push.admins = admins;
  for (const side of SIDES) {
    const raw = (value as Record<string, unknown>)[side];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== 'object') return null;
    const { rewards, redemptions } = raw as Record<string, unknown>;
    if (!Array.isArray(rewards) || !Array.isArray(redemptions) || rewards.length > MAX_ROWS || redemptions.length > MAX_ROWS) return null;
    const objects = (items: unknown[]) => items.every((item) => item && typeof item === 'object' && rowNumber((item as { row?: unknown }).row) !== null);
    if (!objects(rewards) || !objects(redemptions)) return null;
    push[side] = {
      rewards: rewards.map((item) => { const r = item as Record<string, unknown>; return { row: r.row as number, name: text(r.name), points: r.points, listed: r.listed === true }; }),
      redemptions: redemptions.map((item) => { const r = item as Record<string, unknown>; return { row: r.row as number, date: text(r.date), name: text(r.name), reward: text(r.reward), points: r.points }; }),
    };
  }
  return push;
}

const sheetRewardId = (side: Congregation, name: string) => `sheet-${side}-${createHash('sha256').update(name).digest('hex').slice(0, 16)}`;

/**
 * Gives every member a label once; returns label → member, each side's dropdown (enabled members only) and the labels
 * given just now. A deleted member's label is free again, so a label given just now may still sit on the sheet as the
 * deleted member's row: nothing on the sheet under it can be about the new owner yet.
 */
function sheetLabels(db: DatabaseSync): { members: Map<string, string>; lists: Record<Congregation, string[]>; created: Set<string> } {
  const everyone = db.prepare('SELECT id, display_name, disabled_at FROM members ORDER BY rowid').all() as Array<{ id: string; display_name: string; disabled_at: number | null }>;
  const given = new Map((db.prepare('SELECT member_id, label FROM member_sheet_labels').all() as Array<{ member_id: string; label: string }>).map((row) => [row.member_id, row.label]));
  const taken = new Set(given.values());
  const created = new Set<string>();
  const insert = db.prepare('INSERT INTO member_sheet_labels(member_id, label) VALUES(?, ?)');
  for (const member of everyone) {
    if (given.has(member.id)) continue;
    const base = text(member.display_name) || '未命名';
    let label = base;
    for (let n = 2; taken.has(label); n += 1) label = `${base} (${n})`;
    insert.run(member.id, label); given.set(member.id, label); taken.add(label); created.add(label);
  }
  const lists: Record<Congregation, string[]> = { youth: [], main: [] };
  for (const member of everyone) if (!member.disabled_at) lists[congregationOf(db, member.id)].push(given.get(member.id)!);
  for (const side of SIDES) lists[side].sort((left, right) => left.localeCompare(right, 'zh-Hant'));
  return { members: new Map([...given].map(([memberId, label]) => [label, memberId])), lists, created };
}

function applySide(db: DatabaseSync, side: Congregation, sheet: RewardSheetSide, members: Map<string, string>, nowIso: string, rejected: RewardSheetRejection[]): void {
  const nowMs = Date.parse(nowIso);
  const kept: string[] = [];
  const seen = new Set<string>();
  const upsert = db.prepare(`INSERT INTO rewards(reward_id, name, cost_points, active, revision, created_at, updated_at, updated_by, congregation)
    VALUES(?, ?, ?, ?, 1, ?, ?, 'sheet', ?)
    ON CONFLICT(reward_id) DO UPDATE SET
      revision = rewards.revision + (rewards.cost_points <> excluded.cost_points OR rewards.active <> excluded.active OR rewards.name <> excluded.name),
      name = excluded.name, cost_points = excluded.cost_points, active = excluded.active, updated_at = excluded.updated_at, updated_by = 'sheet'`);
  for (const reward of sheet.rewards) {
    if (!reward.name) { rejected.push({ side, tab: 'rewards', row: reward.row, field: 'name' }); continue; }
    if (seen.has(reward.name)) { rejected.push({ side, tab: 'rewards', row: reward.row, field: 'duplicate' }); continue; }
    const points = positivePoints(reward.points);
    if (points === null) { rejected.push({ side, tab: 'rewards', row: reward.row, field: 'points' }); continue; }
    seen.add(reward.name);
    const rewardId = sheetRewardId(side, reward.name);
    kept.push(rewardId);
    upsert.run(rewardId, reward.name, points, reward.listed ? 1 : 0, nowMs, nowMs, side);
  }
  // Prizes taken out of the sheet stay as rows (a member's target still names them) but are no longer listed.
  db.prepare(`UPDATE rewards SET active = 0, updated_at = ?, updated_by = 'sheet' WHERE congregation = ? AND active = 1 AND reward_id NOT IN (SELECT value FROM json_each(?))`).run(nowMs, side, JSON.stringify(kept));
  if (side === 'youth') {
    // The in-app prizes were 青少's: a target on one moves to the sheet prize of the same name, then the old list retires.
    db.prepare(`UPDATE reward_targets SET reward_id = (SELECT s.reward_id FROM rewards s JOIN rewards o ON o.reward_id = reward_targets.reward_id WHERE s.congregation = 'youth' AND s.name = o.name)
      WHERE reward_id IN (SELECT reward_id FROM rewards WHERE congregation IS NULL)
        AND EXISTS (SELECT 1 FROM rewards s JOIN rewards o ON o.reward_id = reward_targets.reward_id WHERE s.congregation = 'youth' AND s.name = o.name)`).run();
    db.prepare("UPDATE rewards SET active = 0, updated_at = ?, updated_by = 'sheet' WHERE congregation IS NULL AND active = 1").run(nowMs);
  }
  db.prepare('DELETE FROM sheet_redemptions WHERE congregation = ?').run(side);
  const insert = db.prepare('INSERT INTO sheet_redemptions(congregation, row_number, member_id, reward_name, points, redeemed_on, synced_at) VALUES(?, ?, ?, ?, ?, ?, ?)');
  for (const row of sheet.redemptions) {
    const memberId = members.get(row.name);
    const points = positivePoints(row.points);
    const field = !memberId ? 'name' : !DATE.test(row.date) || Number.isNaN(Date.parse(`${row.date}T00:00:00Z`)) ? 'date' : points === null ? 'points' : !row.reward ? 'reward' : null;
    if (field) { rejected.push({ side, tab: 'redemptions', row: row.row, field }); continue; }
    insert.run(side, row.row, memberId!, row.reward, points!, row.date, nowIso);
  }
  db.prepare('INSERT INTO reward_sheet_sync(congregation, synced_at) VALUES(?, ?) ON CONFLICT(congregation) DO UPDATE SET synced_at = excluded.synced_at').run(side, nowIso);
}

/**
 * Applies one push atomically. A side the script did not send is left as it was, and so are the administrators when
 * it sent no 管理者 column. `settingsAdminIds` are the private settings' administrators, which the sheet never changes.
 * `newLabels` (not part of the reply) are the labels given in this push: a 管理者 check under one is ignored.
 */
export function applyRewardSheet(db: DatabaseSync, push: RewardSheetPush, nowIso: string, settingsAdminIds: readonly string[] = []): RewardSheetResult & { newLabels: ReadonlySet<string> } {
  db.exec('BEGIN IMMEDIATE');
  try {
    const legacyRewards = (db.prepare('SELECT name, cost_points FROM rewards WHERE congregation IS NULL AND active = 1 ORDER BY cost_points, name').all() as Array<{ name: string; cost_points: number }>)
      .map((row) => ({ name: row.name, points: row.cost_points }));
    const { members, lists, created } = sheetLabels(db);
    const rejected: RewardSheetRejection[] = [];
    for (const side of SIDES) { const sheet = push[side]; if (sheet) applySide(db, side, sheet, members, nowIso, rejected); }
    if (push.admins) applySheetAdminMarks(db, push.admins, new Map([...members].filter(([label]) => !created.has(label))), settingsAdminIds, nowIso);
    db.exec('COMMIT');
    return { labels: lists, rejected, legacyRewards, newLabels: created };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* keep the original failure */ }
    throw error;
  }
}
