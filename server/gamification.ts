import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  calculateBand,
  canonicalMemberPair,
  isValidDateOnly,
  isScoreChartRange,
  isWithinCompletionWindow,
  monthBuckets,
  taipeiDate,
  type MonthPoints,
  type PersonListItem,
  type ScoreChart,
  type ScoreChartBucket,
  type ScoreChartQuery,
  type ScoreChartRange,
  type ScoreProfile,
  type ViewerCapabilities,
} from '../src/domain/gamificationV1';
export { applyPreparedLegacyPointMigration, prepareLegacyPointMigration } from './legacyPointMigration';
export type { LegacyMigrationError, LegacyMigrationPreparation, LegacyMigrationResult, LegacyPointPolicy, PreparedLegacyPointMigration } from './legacyPointMigration';

export function hashFriendToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export const GAMIFICATION_POLICY_VERSION = 'reading-daily-v1';
export const GAMIFICATION_POINT_AMOUNT = 1;
export const FRIEND_TOKEN_TTL_MS = 5 * 60 * 1000;
export const PLAN_ID = 'church-2026-09';

export interface ReadingDaySeed {
  taskDate: string;
  planId: string;
  references: string[];
  sourceRevision?: number;
  sourceDigest?: string;
}

export interface GamificationDatabaseOptions {
  now?: () => Date;
  adminMemberIds?: readonly string[];
}

export interface GamificationError {
  code: string;
  status: 400 | 401 | 403 | 404 | 409;
  details?: Record<string, unknown>;
}

export interface CompletionMutationInput {
  memberId: string;
  planId: string;
  taskDate: string;
  operationId: string;
  expectedRevision: number;
  status: 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED';
  policyAmount?: number;
  policyVersion?: string;
  now?: Date;
}

export interface CompletionMutationResult {
  memberId: string;
  planId: string;
  taskDate: string;
  status: CompletionMutationInput['status'];
  revision: number;
  syncStatus: 'CONFIRMED';
  operationId: string;
  earnedTotal: number;
  redeemableBalance: number;
  points: number;
  pointStatus: 'ACTIVE' | 'UNCONFIGURED';
}

function nowMs(now: Date | undefined, fallback: () => Date): number {
  return (now ?? fallback()).getTime();
}

function iso(now: Date | undefined, fallback: () => Date): string {
  return new Date(nowMs(now, fallback)).toISOString();
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function stablePayload(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stablePayload).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stablePayload(item)}`).join(',')}}`;
}

function payloadDigest(value: unknown): string {
  return digest(JSON.parse(stablePayload(value)));
}

function readInt(row: unknown, key: string, fallback = 0): number {
  if (!row || typeof row !== 'object') return fallback;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : Number(value ?? fallback);
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function memberEnabled(db: DatabaseSync, memberId: string): boolean {
  return Boolean(db.prepare('SELECT id FROM members WHERE id = ? AND (disabled_at IS NULL OR disabled_at = 0)').get(memberId));
}

function memberExists(db: DatabaseSync, memberId: string): boolean {
  return Boolean(db.prepare('SELECT id FROM members WHERE id = ?').get(memberId));
}

function isCompletionStatus(value: unknown): value is CompletionMutationInput['status'] {
  return value === 'UNREPORTED' || value === 'NOT_COMPLETED' || value === 'COMPLETED';
}

function throwError(error: GamificationError): never {
  throw Object.assign(new Error(error.code), { gamification: error });
}

export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the original failure */ }
    throw error;
  }
}

export function ensureGamificationSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reading_days (
      task_date TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      references_json TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      source_digest TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_point_entitlements (
      member_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount >= 0),
      active INTEGER NOT NULL CHECK(active IN (0, 1)),
      completion_revision INTEGER NOT NULL,
      source_policy_version TEXT NOT NULL,
      first_awarded_at INTEGER,
      updated_at INTEGER NOT NULL,
      migration_id TEXT,
      PRIMARY KEY(member_id, task_date)
    );
    CREATE INDEX IF NOT EXISTS daily_point_entitlements_member_active ON daily_point_entitlements(member_id, active);
    CREATE TABLE IF NOT EXISTS wallet_entries (
      entry_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('LEGACY_OPENING_CREDIT', 'READING_CREDIT', 'READING_REVERSAL', 'REDEMPTION_DEBIT', 'REDEMPTION_REVERSAL')),
      delta INTEGER NOT NULL CHECK(delta <> 0),
      task_date TEXT,
      redemption_id TEXT,
      operation_id TEXT,
      created_at INTEGER NOT NULL,
      migration_id TEXT
    );
    CREATE INDEX IF NOT EXISTS wallet_entries_member ON wallet_entries(member_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_entries_operation_kind ON wallet_entries(operation_id, kind) WHERE operation_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS rewards (
      reward_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cost_points INTEGER NOT NULL CHECK(cost_points > 0),
      active INTEGER NOT NULL CHECK(active IN (0, 1)),
      revision INTEGER NOT NULL CHECK(revision > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reward_targets (
      member_id TEXT PRIMARY KEY,
      reward_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS redemptions (
      redemption_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      reward_id TEXT NOT NULL,
      reward_name_snapshot TEXT NOT NULL,
      cost_points_snapshot INTEGER NOT NULL CHECK(cost_points_snapshot > 0),
      reward_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('COMPLETED', 'REVERSED')),
      confirmed_by TEXT NOT NULL,
      confirmed_at INTEGER NOT NULL,
      reversed_by TEXT,
      reversed_at INTEGER,
      reversal_reason TEXT,
      operation_id TEXT NOT NULL,
      reversal_operation_id TEXT
    );
    CREATE INDEX IF NOT EXISTS redemptions_member ON redemptions(member_id, confirmed_at);
    CREATE TABLE IF NOT EXISTS friend_tokens (
      token_hash TEXT PRIMARY KEY,
      owner_member_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS friend_tokens_owner ON friend_tokens(owner_member_id, expires_at);
    CREATE TABLE IF NOT EXISTS friendships (
      member_low TEXT NOT NULL,
      member_high TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      PRIMARY KEY(member_low, member_high)
    );
    CREATE INDEX IF NOT EXISTS friendships_low_created ON friendships(member_low, created_at DESC);
    CREATE INDEX IF NOT EXISTS friendships_high_created ON friendships(member_high, created_at DESC);
    CREATE TABLE IF NOT EXISTS mutation_receipts (
      actor_member_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(actor_member_id, operation_id)
    );
    CREATE TABLE IF NOT EXISTS migration_receipts (
      migration_id TEXT PRIMARY KEY,
      source_digest TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function seedReadingDays(db: DatabaseSync, days: readonly ReadingDaySeed[], now = new Date()): void {
  ensureGamificationSchema(db);
  const insert = db.prepare('INSERT INTO reading_days(task_date, plan_id, references_json, source_revision, source_digest, updated_at) VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const day of days) {
      const references = day.references.map((reference) => reference.trim()).filter(Boolean);
      const planId = day.planId.trim();
      const sourceRevision = day.sourceRevision ?? 1;
      if (!isValidDateOnly(day.taskDate) || !planId || references.length === 0 || !Number.isSafeInteger(sourceRevision) || sourceRevision <= 0) throw new Error('INVALID_READING_DAY');
      const sourceDigest = day.sourceDigest ?? digest({ taskDate: day.taskDate, planId, references });
      const current = db.prepare('SELECT plan_id, references_json, source_revision, source_digest FROM reading_days WHERE task_date = ?').get(day.taskDate) as { plan_id: string; references_json: string; source_revision: number; source_digest: string } | undefined;
      if (!current) {
        insert.run(day.taskDate, planId, JSON.stringify(references), sourceRevision, sourceDigest, now.getTime());
        continue;
      }
      const sameContent = current.plan_id === planId && current.references_json === JSON.stringify(references) && current.source_digest === sourceDigest;
      if (sourceRevision < current.source_revision) throw new Error(`READING_DAY_REVISION_CONFLICT:${day.taskDate}`);
      if (sourceRevision === current.source_revision) {
        if (!sameContent) throw new Error(`READING_DAY_CONFLICT:${day.taskDate}`);
        continue;
      }
      if (current.plan_id !== planId) {
        const hasCompletion = Boolean(db.prepare('SELECT 1 FROM completions WHERE task_date = ? LIMIT 1').get(day.taskDate))
          || Boolean(db.prepare('SELECT 1 FROM daily_point_entitlements WHERE task_date = ? LIMIT 1').get(day.taskDate));
        if (hasCompletion) throw new Error(`READING_DAY_PLAN_CONFLICT:${day.taskDate}`);
      }
      db.prepare('UPDATE reading_days SET plan_id=?, references_json=?, source_revision=?, source_digest=?, updated_at=? WHERE task_date=?')
        .run(planId, JSON.stringify(references), sourceRevision, sourceDigest, now.getTime(), day.taskDate);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve source error */ }
    throw error;
  }
}

export function defaultReadingDays(): ReadingDaySeed[] {
  return [
    ['2026-09-01', ['JHN.12.27-50', 'JHN.13']], ['2026-09-02', ['JHN.13', 'JHN.14']], ['2026-09-03', ['JHN.14', 'JHN.15']],
    ['2026-09-04', ['JHN.15', 'JHN.16']], ['2026-09-05', ['JHN.16', 'JHN.17']], ['2026-09-07', ['JHN.17', 'JHN.18']],
    ['2026-09-08', ['JHN.18', 'JHN.19']], ['2026-09-09', ['JHN.19', 'JHN.20']], ['2026-09-10', ['JHN.20', 'JHN.21']],
    ['2026-09-11', ['PSA.88', 'PSA.89']], ['2026-09-12', ['1TI.1', 'PSA.90', 'PSA.91']], ['2026-09-14', ['1TI.1', '1TI.2', 'PSA.92']],
    ['2026-09-15', ['1TI.2', '1TI.3', 'PSA.93']], ['2026-09-16', ['1TI.3', '1TI.4', 'PSA.94']], ['2026-09-17', ['1TI.4', '1TI.5', 'PSA.95']],
    ['2026-09-18', ['1TI.5', '1TI.6']], ['2026-09-19', ['2TI.1', 'PSA.96', 'PSA.97']], ['2026-09-21', ['2TI.1', '2TI.2']],
    ['2026-09-22', ['2TI.2', '2TI.3']], ['2026-09-23', ['2TI.3', '2TI.4', 'PSA.98']], ['2026-09-24', ['TIT.1', 'PSA.99', 'PSA.100']],
    ['2026-09-25', ['TIT.1', 'TIT.2', 'PSA.101']], ['2026-09-26', ['TIT.2', 'TIT.3', 'PSA.102']], ['2026-09-28', ['PSA.103', 'PSA.104']],
    ['2026-09-29', ['PSA.105']], ['2026-09-30', ['PSA.106']],
  ].map(([taskDate, references]) => ({ taskDate, planId: PLAN_ID, references } as ReadingDaySeed));
}

export function readReadingDays(db: DatabaseSync, from: string, to: string, today: string, memberId: string): { taskDate: string; planId: string; references: string[]; sourceRevision: number; sourceDigest: string; status: CompletionMutationInput['status']; revision: number; canComplete: boolean }[] {
  ensureGamificationSchema(db);
  const rows = db.prepare('SELECT task_date, plan_id, references_json, source_revision, source_digest FROM reading_days WHERE task_date >= ? AND task_date <= ? ORDER BY task_date').all(from, to) as Array<{ task_date: string; plan_id: string; references_json: string; source_revision: number; source_digest: string }>;
  return rows.map((row) => {
    const completion = db.prepare('SELECT status, revision FROM completions WHERE member_id = ? AND plan_id = ? AND task_date = ?').get(memberId, row.plan_id, row.task_date) as { status: CompletionMutationInput['status']; revision: number } | undefined;
    return {
      taskDate: row.task_date,
      planId: row.plan_id,
      references: JSON.parse(row.references_json) as string[],
      sourceRevision: row.source_revision,
      sourceDigest: row.source_digest,
      status: completion?.status ?? 'UNREPORTED',
      revision: completion?.revision ?? 0,
      canComplete: isWithinCompletionWindow(row.task_date, today),
    };
  });
}

function totalEarned(db: DatabaseSync, memberId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM daily_point_entitlements WHERE member_id = ? AND active = 1').get(memberId);
  return Math.max(0, readInt(row, 'total'));
}

function walletBalance(db: DatabaseSync, memberId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM wallet_entries WHERE member_id = ?').get(memberId);
  return readInt(row, 'total');
}

function monthPoints(db: DatabaseSync, memberId: string, buckets: readonly string[]): MonthPoints[] {
  const result = new Map(buckets.map((month) => [month, 0]));
  const rows = db.prepare(`SELECT substr(task_date, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
    FROM daily_point_entitlements WHERE member_id = ? AND active = 1 AND substr(task_date, 1, 7) IN (${buckets.map(() => '?').join(',')}) GROUP BY substr(task_date, 1, 7)`).all(memberId, ...buckets) as Array<{ month: string; total: number }>;
  for (const row of rows) result.set(row.month, Math.max(0, Number(row.total)));
  return buckets.map((month) => ({ month, earnedPoints: result.get(month) ?? 0 }));
}

const SCORE_CHART_DAY_MS = 86_400_000;
const SCORE_CHART_YEAR_PATTERN = /^\d{4}$/;

function chartDate(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function chartDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftChartDate(value: string, days: number): string {
  return chartDateString(new Date(chartDate(value).getTime() + days * SCORE_CHART_DAY_MS));
}

function shiftChartMonth(value: string, months: number): string {
  const [year, month] = value.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  return `${cursor.getUTCFullYear().toString().padStart(4, '0')}-${(cursor.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

function shiftChartYear(value: string, years: number): string {
  return (Number(value) + years).toString().padStart(4, '0');
}

function chartMonthEnd(anchor: string): string {
  const [year, month] = anchor.split('-').map(Number);
  return chartDateString(new Date(Date.UTC(year, month, 0, 12)));
}

function chartYearEnd(anchor: string): string {
  return `${anchor}-12-31`;
}

function chartWeekStart(anchor: string): string {
  const day = chartDate(anchor).getUTCDay();
  return shiftChartDate(anchor, day === 0 ? -6 : 1 - day);
}

function chartYearAnchor(value: string): boolean {
  if (!SCORE_CHART_YEAR_PATTERN.test(value)) return false;
  const year = Number(value);
  return year >= 1000 && year <= 9999;
}

function chartMonthAnchor(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && chartYearAnchor(value.slice(0, 4));
}

function activeEarnedByDate(db: DatabaseSync, memberId: string, from: string, to: string): Map<string, number> {
  const result = new Map<string, number>();
  const rows = db.prepare(`SELECT task_date, COALESCE(SUM(amount), 0) AS total
    FROM daily_point_entitlements
    WHERE member_id = ? AND active = 1 AND task_date >= ? AND task_date <= ?
    GROUP BY task_date`).all(memberId, from, to) as Array<{ task_date: string; total: number }>;
  for (const row of rows) result.set(row.task_date, Math.max(0, Number(row.total)));
  return result;
}

function chartBucket(key: string, startDate: string, endDate: string, earnedPoints: number): ScoreChartBucket {
  return { key, startDate, endDate, earnedPoints: Math.max(0, Math.round(earnedPoints)) };
}

function chartTotal(buckets: readonly ScoreChartBucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.earnedPoints, 0);
}

function buildCalendarBuckets(db: DatabaseSync, memberId: string, range: Exclude<ScoreChartRange, 'all'>, anchor: string, today: string): { periodStart: string; periodEnd: string; buckets: ScoreChartBucket[] } {
  let periodStart: string;
  let periodEnd: string;
  if (range === 'week') {
    periodStart = chartWeekStart(anchor);
    periodEnd = shiftChartDate(periodStart, 6);
  } else if (range === 'month') {
    periodStart = `${anchor}-01`;
    periodEnd = chartMonthEnd(anchor);
  } else {
    periodStart = `${anchor}-01-01`;
    periodEnd = chartYearEnd(anchor);
  }
  const earnedByDate = activeEarnedByDate(db, memberId, periodStart, periodEnd);
  const buckets: ScoreChartBucket[] = [];
  if (range === 'year') {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${anchor}-${month.toString().padStart(2, '0')}`;
      const startDate = `${key}-01`;
      const endDate = chartMonthEnd(key);
      let earnedPoints = 0;
      for (let date = startDate; date <= endDate; date = shiftChartDate(date, 1)) earnedPoints += earnedByDate.get(date) ?? 0;
      buckets.push(chartBucket(key, startDate, endDate, earnedPoints));
    }
  } else {
    for (let date = periodStart; date <= periodEnd; date = shiftChartDate(date, 1)) buckets.push(chartBucket(date, date, date, earnedByDate.get(date) ?? 0));
  }
  return { periodStart, periodEnd, buckets };
}

function chartAnchorFor(range: ScoreChartRange, requestedAnchor: string | undefined, anchorMonth: string, today: string): string | null {
  if (range === 'all') return null;
  if (range === 'week') {
    const raw = requestedAnchor ?? today;
    if (!isValidDateOnly(raw) || !chartYearAnchor(raw.slice(0, 4))) throw new Error('INVALID_CHART_ANCHOR');
    if (raw > today) throw new Error('FUTURE_CHART_PERIOD');
    return chartWeekStart(raw);
  }
  if (range === 'month') {
    const raw = requestedAnchor ?? anchorMonth;
    if (!chartMonthAnchor(raw)) throw new Error('INVALID_CHART_ANCHOR');
    if (raw > today.slice(0, 7)) throw new Error('FUTURE_CHART_PERIOD');
    return raw;
  }
  const raw = requestedAnchor ?? anchorMonth.slice(0, 4);
  if (!chartYearAnchor(raw)) throw new Error('INVALID_CHART_ANCHOR');
  if (raw > today.slice(0, 4)) throw new Error('FUTURE_CHART_PERIOD');
  return raw;
}

function getAllChart(db: DatabaseSync, memberId: string): ScoreChart {
  const rows = db.prepare(`SELECT MIN(task_date) AS first_date, MAX(task_date) AS last_date
    FROM daily_point_entitlements WHERE member_id = ? AND active = 1`).all(memberId) as Array<{ first_date: string | null; last_date: string | null }>;
  const firstDate = rows[0]?.first_date ?? null;
  const lastDate = rows[0]?.last_date ?? null;
  if (!firstDate || !lastDate) return { range: 'all', anchor: null, periodStart: null, periodEnd: null, earnedPoints: 0, buckets: [], previousAnchor: null, nextAnchor: null };
  const firstYear = Number(firstDate.slice(0, 4));
  const lastYear = Number(lastDate.slice(0, 4));
  const earnedByDate = activeEarnedByDate(db, memberId, `${firstYear.toString().padStart(4, '0')}-01-01`, lastDate);
  const buckets: ScoreChartBucket[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    const key = year.toString().padStart(4, '0');
    let earnedPoints = 0;
    for (const [date, amount] of earnedByDate) if (date.slice(0, 4) === key) earnedPoints += amount;
    buckets.push(chartBucket(key, `${key}-01-01`, `${key}-12-31`, earnedPoints));
  }
  return { range: 'all', anchor: null, periodStart: firstDate, periodEnd: lastDate, earnedPoints: chartTotal(buckets), buckets, previousAnchor: null, nextAnchor: null };
}

export function getScoreChart(db: DatabaseSync, memberId: string, query: ScoreChartQuery, today: string, defaultMonth = today.slice(0, 7)): ScoreChart {
  if (!isScoreChartRange(query.range)) throw new Error('INVALID_CHART_RANGE');
  if (query.range === 'all') return getAllChart(db, memberId);
  const anchor = chartAnchorFor(query.range, query.anchor, defaultMonth, today);
  if (!anchor) throw new Error('INVALID_CHART_ANCHOR');
  const calendar = buildCalendarBuckets(db, memberId, query.range, anchor, today);
  const previousCandidate = query.range === 'week' ? shiftChartDate(anchor, -7) : query.range === 'month' ? shiftChartMonth(anchor, -1) : shiftChartYear(anchor, -1);
  const previousYear = previousCandidate.slice(0, 4);
  const previousAnchor = chartYearAnchor(previousYear) ? previousCandidate : null;
  const nextCandidate = query.range === 'week' ? shiftChartDate(anchor, 7) : query.range === 'month' ? shiftChartMonth(anchor, 1) : shiftChartYear(anchor, 1);
  const nextStart = query.range === 'week' ? nextCandidate : query.range === 'month' ? `${nextCandidate}-01` : `${nextCandidate}-01-01`;
  const nextAnchor = nextStart <= today ? nextCandidate : null;
  return { range: query.range, anchor, periodStart: calendar.periodStart, periodEnd: calendar.periodEnd, earnedPoints: chartTotal(calendar.buckets), buckets: calendar.buckets, previousAnchor, nextAnchor };
}

function allEarnedTotals(db: DatabaseSync): Array<{ memberId: string; total: number; enabled: boolean }> {
  const rows = db.prepare(`SELECT m.id AS member_id, m.disabled_at, COALESCE(SUM(CASE WHEN e.active = 1 THEN e.amount ELSE 0 END), 0) AS total
    FROM members m LEFT JOIN daily_point_entitlements e ON e.member_id = m.id GROUP BY m.id, m.disabled_at`).all() as Array<{ member_id: string; disabled_at: number | null; total: number }>;
  return rows.map((row) => ({ memberId: row.member_id, total: Math.max(0, Number(row.total)), enabled: row.disabled_at === null || row.disabled_at === 0 }));
}

function targetReward(db: DatabaseSync, memberId: string): ScoreProfile['private'] extends infer T ? T extends { targetReward: infer U } ? U : never : never {
  const row = db.prepare(`SELECT r.reward_id, r.name, r.cost_points, r.active, r.revision FROM reward_targets t JOIN rewards r ON r.reward_id = t.reward_id WHERE t.member_id = ?`).get(memberId) as { reward_id: string; name: string; cost_points: number; active: number; revision: number } | undefined;
  return row ? { rewardId: row.reward_id, name: row.name, costPoints: row.cost_points, active: bool(row.active), revision: row.revision } : null;
}

export function getViewerCapabilities(db: DatabaseSync, memberId: string, adminMemberIds: readonly string[] = []): ViewerCapabilities {
  const admin = adminMemberIds.includes(memberId);
  return { canViewAllScores: admin, canManageRewards: admin, canRedeemRewards: admin };
}

function friendshipExists(db: DatabaseSync, first: string, second: string): boolean {
  const pair = canonicalMemberPair(first, second);
  return Boolean(pair && db.prepare('SELECT 1 FROM friendships WHERE member_low = ? AND member_high = ?').get(pair.memberLow, pair.memberHigh));
}

export function canViewMember(db: DatabaseSync, viewerId: string, memberId: string, adminMemberIds: readonly string[] = []): boolean {
  if (!memberEnabled(db, memberId) && !adminMemberIds.includes(viewerId)) return false;
  return viewerId === memberId || adminMemberIds.includes(viewerId) || friendshipExists(db, viewerId, memberId);
}

export function getPeople(db: DatabaseSync, viewerId: string, scope: 'friends' | 'all', adminMemberIds: readonly string[] = []): PersonListItem[] | GamificationError {
  if (scope === 'all' && !adminMemberIds.includes(viewerId)) return { status: 403, code: 'ADMIN_REQUIRED' };
  const members = scope === 'all'
    ? db.prepare('SELECT id, display_name FROM members ORDER BY id').all() as Array<{ id: string; display_name: string }>
    : db.prepare(`SELECT CASE WHEN f.member_low = ? THEN f.member_high ELSE f.member_low END AS id, m.display_name, f.created_at
      FROM friendships f JOIN members m ON m.id = CASE WHEN f.member_low = ? THEN f.member_high ELSE f.member_low END
      WHERE (f.member_low = ? OR f.member_high = ?) AND (m.disabled_at IS NULL OR m.disabled_at = 0) ORDER BY f.created_at DESC, id`).all(viewerId, viewerId, viewerId, viewerId) as Array<{ id: string; display_name: string; created_at: number }>;
  const totals = allEarnedTotals(db);
  const totalByMember = new Map(totals.map((row) => [row.memberId, row]));
  const eligible = totals.filter((row) => row.enabled && row.total > 0).map((row) => row.total);
  return members.map((member) => {
    const score = totalByMember.get(member.id) ?? { total: 0, enabled: false };
    const rank = scope === 'all' && score.enabled && score.total > 0 ? 1 + eligible.filter((value) => value > score.total).length : null;
    return { memberId: member.id, displayName: member.display_name, earnedTotal: score.total, ...(scope === 'all' ? { rank } : {}) };
  }).sort((left, right) => scope === 'all'
    ? right.earnedTotal - left.earnedTotal || left.memberId.localeCompare(right.memberId)
    : 0);
}

export function getScoreProfile(db: DatabaseSync, viewerId: string, memberId: string, anchorMonth: string, adminMemberIds: readonly string[] = [], chartQuery: ScoreChartQuery = { range: 'month' }, today = taipeiDate()): ScoreProfile | GamificationError {
  if (!memberExists(db, memberId) || !canViewMember(db, viewerId, memberId, adminMemberIds)) return { status: 404, code: 'MEMBER_NOT_ACCESSIBLE' };
  const member = db.prepare('SELECT display_name FROM members WHERE id = ?').get(memberId) as { display_name: string };
  const buckets = monthBuckets(anchorMonth);
  const earnedTotal = totalEarned(db, memberId);
  const totals = allEarnedTotals(db).filter((row) => row.enabled && row.total > 0).map((row) => row.total);
  const isPrivate = viewerId === memberId || adminMemberIds.includes(viewerId);
  const result: ScoreProfile = {
    memberId,
    displayName: member.display_name,
    earnedTotal,
    band: calculateBand(earnedTotal, totals),
    months: monthPoints(db, memberId, buckets),
    chart: getScoreChart(db, memberId, { range: chartQuery.range, ...(chartQuery.anchor ? { anchor: chartQuery.anchor } : {}) }, today, anchorMonth),
    permissions: { canEditTarget: viewerId === memberId, canRedeem: adminMemberIds.includes(viewerId) },
  };
  if (isPrivate) result.private = { redeemableBalance: walletBalance(db, memberId), targetReward: targetReward(db, memberId) };
  return result;
}

export function getRewards(db: DatabaseSync): Array<{ rewardId: string; name: string; costPoints: number; active: boolean; revision: number }> {
  return (db.prepare('SELECT reward_id, name, cost_points, active, revision FROM rewards WHERE active = 1 ORDER BY cost_points, name, reward_id').all() as Array<{ reward_id: string; name: string; cost_points: number; active: number; revision: number }>).map((row) => ({ rewardId: row.reward_id, name: row.name, costPoints: row.cost_points, active: true, revision: row.revision }));
}

export function readMutationReceipt(db: DatabaseSync, actorMemberId: string, operationId: string, payload: unknown): { result: Record<string, unknown> } | GamificationError | null {
  const row = db.prepare('SELECT payload_hash, result_json FROM mutation_receipts WHERE actor_member_id = ? AND operation_id = ?').get(actorMemberId, operationId) as { payload_hash: string; result_json: string } | undefined;
  if (!row) return null;
  if (row.payload_hash !== payloadDigest(payload)) return { status: 409, code: 'OPERATION_ID_REUSED' };
  return { result: JSON.parse(row.result_json) as Record<string, unknown> };
}

export function writeMutationReceipt(db: DatabaseSync, actorMemberId: string, operationId: string, operationType: string, payload: unknown, entityType: string, entityId: string, result: Record<string, unknown>, now: number): void {
  db.prepare(`INSERT INTO mutation_receipts(actor_member_id, operation_id, operation_type, payload_hash, entity_type, entity_id, result_json, created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(actorMemberId, operationId, operationType, payloadDigest(payload), entityType, entityId, JSON.stringify(result), now);
}

export function issueFriendToken(db: DatabaseSync, ownerMemberId: string, options: GamificationDatabaseOptions = {}): { token: string; payload: string; createdAt: number; expiresAt: number } | GamificationError {
  if (!memberEnabled(db, ownerMemberId)) return { status: 403, code: 'AUTH_INVALID' };
  const now = nowMs(undefined, options.now ?? (() => new Date()));
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + FRIEND_TOKEN_TTL_MS;
  db.prepare('INSERT INTO friend_tokens(token_hash, owner_member_id, created_at, expires_at, revoked_at) VALUES(?,?,?,?,NULL)').run(hashFriendToken(token), ownerMemberId, now, expiresAt);
  return { token, payload: `qingmu://friend/add?token=${encodeURIComponent(token)}`, createdAt: now, expiresAt };
}

export function claimFriend(db: DatabaseSync, actorMemberId: string, operationId: string, token: string, options: GamificationDatabaseOptions = {}): Record<string, unknown> | GamificationError {
  if (!memberEnabled(db, actorMemberId)) return { status: 401, code: 'AUTH_INVALID' };
  const payload = { token };
  const prior = readMutationReceipt(db, actorMemberId, operationId, payload);
  if (prior) return 'result' in prior ? prior.result : prior;
  const now = nowMs(undefined, options.now ?? (() => new Date()));
  return transaction(db, () => {
    const row = db.prepare('SELECT owner_member_id, expires_at, revoked_at FROM friend_tokens WHERE token_hash = ?').get(hashFriendToken(token)) as { owner_member_id: string; expires_at: number; revoked_at: number | null } | undefined;
    if (!row || row.revoked_at !== null || row.expires_at <= now) return { status: 409, code: 'FRIEND_QR_EXPIRED' };
    if (!memberEnabled(db, row.owner_member_id)) return { status: 409, code: 'FRIEND_QR_EXPIRED' };
    const pair = canonicalMemberPair(actorMemberId, row.owner_member_id);
    if (!pair) return { status: 409, code: 'SELF_FRIEND_NOT_ALLOWED' };
    const inserted = db.prepare('INSERT INTO friendships(member_low, member_high, created_at, created_by, operation_id) VALUES(?,?,?,?,?) ON CONFLICT(member_low, member_high) DO NOTHING').run(pair.memberLow, pair.memberHigh, now, actorMemberId, operationId);
    const result = { memberId: row.owner_member_id, friendshipCreated: Number(inserted.changes) === 1, createdAt: now };
    writeMutationReceipt(db, actorMemberId, operationId, 'FRIEND_CLAIM', payload, 'friendship', `${pair.memberLow}:${pair.memberHigh}`, result, now);
    return result;
  });
}

export function removeFriend(db: DatabaseSync, actorMemberId: string, otherMemberId: string, options: GamificationDatabaseOptions = {}): boolean | GamificationError {
  const pair = canonicalMemberPair(actorMemberId, otherMemberId);
  if (!pair) return { status: 409, code: 'SELF_FRIEND_NOT_ALLOWED' };
  const now = nowMs(undefined, options.now ?? (() => new Date()));
  const result = transaction(db, () => {
    const deleted = db.prepare('DELETE FROM friendships WHERE member_low = ? AND member_high = ?').run(pair.memberLow, pair.memberHigh);
    db.prepare('UPDATE friend_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE owner_member_id = ? AND revoked_at IS NULL AND expires_at > ?').run(now, actorMemberId, now);
    return Number(deleted.changes) === 1;
  });
  return result;
}

export function setRewardTarget(db: DatabaseSync, memberId: string, rewardId: string, options: GamificationDatabaseOptions = {}): Record<string, unknown> | GamificationError {
  const reward = db.prepare('SELECT reward_id, active FROM rewards WHERE reward_id = ?').get(rewardId) as { reward_id: string; active: number } | undefined;
  if (!reward || !bool(reward.active)) return { status: 409, code: 'REWARD_NOT_AVAILABLE' };
  const now = nowMs(undefined, options.now ?? (() => new Date()));
  db.prepare(`INSERT INTO reward_targets(member_id, reward_id, updated_at) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET reward_id=excluded.reward_id, updated_at=excluded.updated_at`).run(memberId, rewardId, now);
  return { rewardId, updatedAt: now };
}

export function getRedemptions(db: DatabaseSync, memberId: string): Array<Record<string, unknown>> {
  return (db.prepare(`SELECT redemption_id, member_id, reward_id, reward_name_snapshot, cost_points_snapshot, reward_revision, status, confirmed_by, confirmed_at, reversed_by, reversed_at, reversal_reason
    FROM redemptions WHERE member_id = ? ORDER BY confirmed_at DESC, redemption_id`).all(memberId) as Array<Record<string, unknown>>).map((row) => ({
    redemptionId: row.redemption_id,
    memberId: row.member_id,
    rewardId: row.reward_id,
    rewardName: row.reward_name_snapshot,
    costPoints: row.cost_points_snapshot,
    rewardRevision: row.reward_revision,
    status: row.status,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    ...(row.reversed_by ? { reversedBy: row.reversed_by } : {}),
    ...(row.reversed_at ? { reversedAt: row.reversed_at } : {}),
    ...(row.reversal_reason ? { reversalReason: row.reversal_reason } : {}),
  }));
}

/**
 * The single place a `rewards` row is born.
 *
 * Two paths create rewards now — a 輔導 adding one directly, and a 輔導 approving a student's
 * nomination — and a prize created down one path must be indistinguishable from the other. Sharing
 * the insert is what guarantees that rather than hoping two call sites stay in step.
 */
export function insertReward(db: DatabaseSync, actorMemberId: string, name: string, costPoints: number, nowMs: number): Record<string, unknown> {
  const rewardId = randomUUID();
  db.prepare('INSERT INTO rewards(reward_id, name, cost_points, active, revision, created_at, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?)')
    .run(rewardId, name.trim(), costPoints, 1, 1, nowMs, nowMs, actorMemberId);
  return { rewardId, name: name.trim(), costPoints, active: true, revision: 1 };
}

export function createReward(db: DatabaseSync, actorMemberId: string, operationId: string, name: string, costPoints: number, options: GamificationDatabaseOptions = {}): Record<string, unknown> | GamificationError {
  const payload = { name, costPoints };
  const prior = readMutationReceipt(db, actorMemberId, operationId, payload);
  if (prior) return 'result' in prior ? prior.result : prior;
  if (!name.trim() || !Number.isSafeInteger(costPoints) || costPoints <= 0) return { status: 400, code: 'INVALID_REWARD' };
  const now = nowMs(undefined, options.now ?? (() => new Date()));
  return transaction(db, () => {
    const result = insertReward(db, actorMemberId, name, costPoints, now);
    const rewardId = result.rewardId as string;
    writeMutationReceipt(db, actorMemberId, operationId, 'REWARD_CREATE', payload, 'reward', rewardId, result, now);
    return result;
  });
}

export function updateReward(db: DatabaseSync, actorMemberId: string, operationId: string, rewardId: string, input: { name?: string; costPoints?: number; active?: boolean; expectedRevision: number }, options: GamificationDatabaseOptions = {}): Record<string, unknown> | GamificationError {
  const payload = { rewardId, ...input };
  const prior = readMutationReceipt(db, actorMemberId, operationId, payload);
  if (prior) return 'result' in prior ? prior.result : prior;
  const now = nowMs(undefined, options.now ?? (() => new Date()));
  return transaction(db, () => {
    const current = db.prepare('SELECT name, cost_points, active, revision FROM rewards WHERE reward_id = ?').get(rewardId) as { name: string; cost_points: number; active: number; revision: number } | undefined;
    if (!current) return { status: 404, code: 'REWARD_NOT_FOUND' };
    if (current.revision !== input.expectedRevision) return { status: 409, code: 'REWARD_CHANGED', details: { revision: current.revision } };
    const name = input.name === undefined ? current.name : input.name.trim();
    const costPoints = input.costPoints === undefined ? current.cost_points : input.costPoints;
    const active = input.active === undefined ? bool(current.active) : input.active;
    if (!name || !Number.isSafeInteger(costPoints) || costPoints <= 0) return { status: 400, code: 'INVALID_REWARD' };
    const revision = current.revision + 1;
    db.prepare('UPDATE rewards SET name=?, cost_points=?, active=?, revision=?, updated_at=?, updated_by=? WHERE reward_id=?').run(name, costPoints, active ? 1 : 0, revision, now, actorMemberId, rewardId);
    const result = { rewardId, name, costPoints, active, revision };
    writeMutationReceipt(db, actorMemberId, operationId, 'REWARD_UPDATE', payload, 'reward', rewardId, result, now);
    return result;
  });
}

function currentRedemptionResult(db: DatabaseSync, cached: Record<string, unknown>): Record<string, unknown> {
  const redemptionId = typeof cached.redemptionId === 'string' ? cached.redemptionId : null;
  if (!redemptionId) return cached;
  const current = db.prepare('SELECT member_id, status FROM redemptions WHERE redemption_id = ?').get(redemptionId) as { member_id: string; status: string } | undefined;
  if (!current) return cached;
  // A receipt is an idempotency record, not a frozen view of a mutable
  // redemption. A later reversal must be visible when the original create
  // operation is retried, while the wallet balance is read from the ledger.
  return { ...cached, memberId: current.member_id, status: current.status, redeemableBalance: walletBalance(db, current.member_id) };
}

export function redeemReward(db: DatabaseSync, actorMemberId: string, input: { operationId: string; memberId: string; rewardId: string; expectedRewardRevision: number }, options: GamificationDatabaseOptions = {}): Record<string, unknown> | GamificationError {
  const payload = { memberId: input.memberId, rewardId: input.rewardId, expectedRewardRevision: input.expectedRewardRevision };
  const prior = readMutationReceipt(db, actorMemberId, input.operationId, payload);
  if (prior) return 'result' in prior ? currentRedemptionResult(db, prior.result) : prior;
  const now = nowMs(undefined, options.now ?? (() => new Date()));
  return transaction(db, () => {
    const reward = db.prepare('SELECT name, cost_points, active, revision FROM rewards WHERE reward_id = ?').get(input.rewardId) as { name: string; cost_points: number; active: number; revision: number } | undefined;
    if (!reward || !bool(reward.active)) return { status: 409, code: 'REWARD_NOT_AVAILABLE' };
    if (reward.revision !== input.expectedRewardRevision) return { status: 409, code: 'REWARD_CHANGED', details: { revision: reward.revision } };
    if (!memberEnabled(db, input.memberId)) return { status: 404, code: 'MEMBER_NOT_ACCESSIBLE' };
    const balance = walletBalance(db, input.memberId);
    if (balance < reward.cost_points) return { status: 409, code: 'INSUFFICIENT_POINTS', details: { balance } };
    const redemptionId = randomUUID();
    db.prepare(`INSERT INTO redemptions(redemption_id, member_id, reward_id, reward_name_snapshot, cost_points_snapshot, reward_revision, status, confirmed_by, confirmed_at, operation_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(redemptionId, input.memberId, input.rewardId, reward.name, reward.cost_points, reward.revision, 'COMPLETED', actorMemberId, now, input.operationId);
    db.prepare(`INSERT INTO wallet_entries(entry_id, member_id, kind, delta, redemption_id, operation_id, created_at) VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), input.memberId, 'REDEMPTION_DEBIT', -reward.cost_points, redemptionId, input.operationId, now);
    const result = { redemptionId, memberId: input.memberId, rewardId: input.rewardId, rewardName: reward.name, costPoints: reward.cost_points, status: 'COMPLETED', redeemableBalance: balance - reward.cost_points };
    writeMutationReceipt(db, actorMemberId, input.operationId, 'REDEMPTION_CREATE', payload, 'redemption', redemptionId, result, now);
    return result;
  });
}

export function reverseRedemption(db: DatabaseSync, actorMemberId: string, redemptionId: string, operationId: string, reason: string, options: GamificationDatabaseOptions = {}): Record<string, unknown> | GamificationError {
  const payload = { redemptionId, reason };
  const prior = readMutationReceipt(db, actorMemberId, operationId, payload);
  if (prior) return 'result' in prior ? prior.result : prior;
  if (!reason.trim()) return { status: 400, code: 'REVERSAL_REASON_REQUIRED' };
  const now = nowMs(undefined, options.now ?? (() => new Date()));
  return transaction(db, () => {
    const redemption = db.prepare('SELECT member_id, cost_points_snapshot, status FROM redemptions WHERE redemption_id = ?').get(redemptionId) as { member_id: string; cost_points_snapshot: number; status: string } | undefined;
    if (!redemption) return { status: 404, code: 'REDEMPTION_NOT_FOUND' };
    if (redemption.status === 'REVERSED') return { status: 409, code: 'REDEMPTION_ALREADY_REVERSED' };
    db.prepare('UPDATE redemptions SET status=?, reversed_by=?, reversed_at=?, reversal_reason=?, reversal_operation_id=? WHERE redemption_id=? AND status=\'COMPLETED\'').run('REVERSED', actorMemberId, now, reason.trim(), operationId, redemptionId);
    db.prepare(`INSERT INTO wallet_entries(entry_id, member_id, kind, delta, redemption_id, operation_id, created_at) VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), redemption.member_id, 'REDEMPTION_REVERSAL', redemption.cost_points_snapshot, redemptionId, operationId, now);
    const result = { redemptionId, memberId: redemption.member_id, status: 'REVERSED', redeemableBalance: walletBalance(db, redemption.member_id) };
    writeMutationReceipt(db, actorMemberId, operationId, 'REDEMPTION_REVERSE', payload, 'redemption', redemptionId, result, now);
    return result;
  });
}

function completionFingerprint(input: CompletionMutationInput): string {
  return digest({ memberId: input.memberId, planId: input.planId, taskDate: input.taskDate, status: input.status });
}

function completionResponse(db: DatabaseSync, input: CompletionMutationInput, revision: number, policyAmount: number, policyVersion: string): CompletionMutationResult {
  const earnedTotal = totalEarned(db, input.memberId);
  const redeemableBalance = walletBalance(db, input.memberId);
  return {
    memberId: input.memberId,
    planId: input.planId,
    taskDate: input.taskDate,
    status: input.status,
    revision,
    syncStatus: 'CONFIRMED',
    operationId: input.operationId,
    earnedTotal,
    redeemableBalance,
    points: earnedTotal,
    pointStatus: policyAmount > 0 && policyVersion ? 'ACTIVE' : 'UNCONFIGURED',
  };
}

export function mutateCompletion(db: DatabaseSync, input: CompletionMutationInput): CompletionMutationResult | GamificationError {
  ensureGamificationSchema(db);
  if (!memberEnabled(db, input.memberId)) return { status: 401, code: 'AUTH_INVALID' };
  if (!isCompletionStatus(input.status) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !input.operationId.trim()) return { status: 400, code: 'INVALID_COMPLETION_COMMAND' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.taskDate)) return { status: 400, code: 'INVALID_DATE' };
  const fingerprint = completionFingerprint(input);
  const operation = db.prepare('SELECT response_json, command_fingerprint FROM operations WHERE operation_id = ?').get(input.operationId) as { response_json: string; command_fingerprint: string | null } | undefined;
  if (operation) {
    const response = JSON.parse(operation.response_json) as CompletionMutationResult;
    const sameTypedCommand = response.memberId === input.memberId && response.planId === input.planId && response.taskDate === input.taskDate && response.status === input.status;
    if (!operation.command_fingerprint) return { status: 409, code: 'OPERATION_REPLAY_UNVERIFIED' };
    if (operation.command_fingerprint !== fingerprint && !sameTypedCommand) return { status: 409, code: 'OPERATION_ID_REUSED' };
    const current = db.prepare('SELECT status, revision FROM completions WHERE member_id = ? AND plan_id = ? AND task_date = ?').get(input.memberId, input.planId, input.taskDate) as { status: string; revision: number } | undefined;
    if (!current || current.status !== response.status || current.revision !== response.revision) return { status: 409, code: 'OPERATION_REPLAY_STALE', details: { status: current?.status ?? 'UNREPORTED', revision: current?.revision ?? 0 } };
    return response;
  }
  const nowDate = input.now ?? new Date();
  const today = taipeiDate(nowDate);
  const schedule = db.prepare('SELECT plan_id FROM reading_days WHERE task_date = ?').get(input.taskDate) as { plan_id: string } | undefined;
  if (!schedule) return { status: 409, code: 'UNSCHEDULED_DAY' };
  if (schedule.plan_id !== input.planId) return { status: 409, code: 'UNSCHEDULED_DAY' };
  if (!isWithinCompletionWindow(input.taskDate, today)) return { status: 409, code: 'OUTSIDE_COMPLETION_WINDOW' };
  const policyAmount = Math.max(0, Number.isSafeInteger(input.policyAmount) ? Number(input.policyAmount) : GAMIFICATION_POINT_AMOUNT);
  const policyVersion = input.policyVersion ?? GAMIFICATION_POLICY_VERSION;
  return transaction(db, () => {
    const secondOperation = db.prepare('SELECT response_json, command_fingerprint FROM operations WHERE operation_id = ?').get(input.operationId) as { response_json: string; command_fingerprint: string | null } | undefined;
    if (secondOperation) {
      const response = JSON.parse(secondOperation.response_json) as CompletionMutationResult;
      if (!secondOperation.command_fingerprint) return { status: 409, code: 'OPERATION_REPLAY_UNVERIFIED' };
      if (secondOperation.command_fingerprint !== fingerprint && !(response.memberId === input.memberId && response.planId === input.planId && response.taskDate === input.taskDate && response.status === input.status)) return { status: 409, code: 'OPERATION_ID_REUSED' };
      return response;
    }
    const current = db.prepare('SELECT status, revision FROM completions WHERE member_id = ? AND plan_id = ? AND task_date = ?').get(input.memberId, input.planId, input.taskDate) as { status: CompletionMutationInput['status']; revision: number } | undefined;
    const currentStatus = current?.status ?? 'UNREPORTED';
    const currentRevision = current?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) return { status: 409, code: 'REVISION_CONFLICT', details: { status: currentStatus, revision: currentRevision } };
    const entitlement = db.prepare('SELECT amount, active FROM daily_point_entitlements WHERE member_id = ? AND task_date = ?').get(input.memberId, input.taskDate) as { amount: number; active: number } | undefined;
    const amount = entitlement?.amount ?? policyAmount;
    const becomesCompleted = input.status === 'COMPLETED' && currentStatus !== 'COMPLETED';
    const leavesCompleted = currentStatus === 'COMPLETED' && input.status !== 'COMPLETED';
    if (leavesCompleted && bool(entitlement?.active) && walletBalance(db, input.memberId) < amount) return { status: 409, code: 'POINTS_ALREADY_SPENT' };
    const revision = currentRevision + 1;
    if (current) db.prepare('UPDATE completions SET status=?, revision=?, sync_status=?, last_operation_id=? WHERE member_id=? AND plan_id=? AND task_date=?').run(input.status, revision, 'CONFIRMED', input.operationId, input.memberId, input.planId, input.taskDate);
    else db.prepare('INSERT INTO completions(member_id, plan_id, task_date, status, revision, sync_status, last_operation_id) VALUES(?,?,?,?,?,?,?)').run(input.memberId, input.planId, input.taskDate, input.status, revision, 'CONFIRMED', input.operationId);
    const timestamp = nowDate.getTime();
    if (becomesCompleted && !bool(entitlement?.active)) {
      db.prepare(`INSERT INTO daily_point_entitlements(member_id, task_date, plan_id, amount, active, completion_revision, source_policy_version, first_awarded_at, updated_at, migration_id)
        VALUES(?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(member_id, task_date) DO UPDATE SET plan_id=excluded.plan_id, amount=excluded.amount, active=1, completion_revision=excluded.completion_revision, source_policy_version=excluded.source_policy_version, first_awarded_at=COALESCE(daily_point_entitlements.first_awarded_at, excluded.first_awarded_at), updated_at=excluded.updated_at`).run(input.memberId, input.taskDate, input.planId, amount, 1, revision, policyVersion, timestamp, timestamp);
      db.prepare('INSERT INTO wallet_entries(entry_id, member_id, kind, delta, task_date, operation_id, created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), input.memberId, 'READING_CREDIT', amount, input.taskDate, input.operationId, timestamp);
    } else if (leavesCompleted && bool(entitlement?.active)) {
      db.prepare('UPDATE daily_point_entitlements SET active=0, completion_revision=?, updated_at=? WHERE member_id=? AND task_date=?').run(revision, timestamp, input.memberId, input.taskDate);
      db.prepare('INSERT INTO wallet_entries(entry_id, member_id, kind, delta, task_date, operation_id, created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), input.memberId, 'READING_REVERSAL', -amount, input.taskDate, input.operationId, timestamp);
    } else if (entitlement && !becomesCompleted && !leavesCompleted) {
      db.prepare('UPDATE daily_point_entitlements SET completion_revision=?, updated_at=? WHERE member_id=? AND task_date=?').run(revision, timestamp, input.memberId, input.taskDate);
    }
    // Keep the legacy event table populated for old clients/reporting. New totals use the immutable entitlement and wallet tables above.
    if (policyAmount > 0) db.prepare('INSERT OR IGNORE INTO point_events(event_id, member_id, completion_key, status, policy_version) VALUES(?,?,?,?,?)').run(input.operationId, input.memberId, `${input.memberId}:${input.planId}:${input.taskDate}`, input.status === 'COMPLETED' ? 'COMPLETED' : 'NOT_COMPLETED', policyVersion);
    const response = completionResponse(db, input, revision, policyAmount, policyVersion);
    db.prepare('INSERT INTO operations(operation_id, response_json, command_fingerprint) VALUES(?,?,?)').run(input.operationId, JSON.stringify(response), fingerprint);
    return response;
  });
}
