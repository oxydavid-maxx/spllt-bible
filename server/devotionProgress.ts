import type { DatabaseSync } from 'node:sqlite';
import { isWithinCompletionWindow } from '../src/domain/gamificationV1';

/**
 * The 積分 page's two blocks (維護者 2026-10-14):
 *
 * - 團體: how many people read each day, and the group prizes the church buys when enough of the
 *   youth read fifteen days in a month. Only scripture reading counts here.
 * - 個人: the member's own 靈修 days beside their reading, and the history behind the
 *   總積分 / 每月 chart.
 *
 * 靈修 earns no points and is not part of any group number. It is stored apart from completions so
 * that nothing that counts points can ever see it.
 */

/** A day's count is shown only once at least this many read, so no single reader is singled out. */
export const MIN_GROUP_READERS = 2;
export const QUALIFYING_DAYS_PER_MONTH = 15;
/** The first month the group prizes count. */
export const GROUP_PRIZES_FROM = '2026-10';

export interface GroupPrize {
  id: string;
  name: string;
  icon: 'beanbag' | 'sofa';
  members: number;
  months: number;
}

export const GROUP_PRIZES: readonly GroupPrize[] = [
  { id: 'beanbag', name: '新的懶骨頭 (摩脫教室)', icon: 'beanbag', members: 15, months: 2 },
  { id: 'sofa', name: '新沙發', icon: 'sofa', members: 20, months: 4 },
];

export function ensureDevotionSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devotion_completions (
      member_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (member_id, task_date)
    );
  `);
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthEnd(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0, 12)).toISOString().slice(0, 10);
}

function nextMonth(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 1, 12)).toISOString().slice(0, 7);
}

export function listDevotionDates(db: DatabaseSync, memberId: string, from: string, to: string): string[] | null {
  if (!DATE.test(from) || !DATE.test(to) || from > to) return null;
  const rows = db.prepare('SELECT task_date FROM devotion_completions WHERE member_id = ? AND task_date >= ? AND task_date <= ? ORDER BY task_date')
    .all(memberId, from, to) as Array<{ task_date: string }>;
  return rows.map((row) => row.task_date);
}

export type DevotionWriteResult = { taskDate: string; completed: boolean } | { error: 'INVALID_DATE' | 'OUTSIDE_COMPLETION_WINDOW' };

/** Setting the same day twice leaves one record; an undo of a day never marked is a no-op. */
export function setDevotion(db: DatabaseSync, memberId: string, taskDate: string, completed: boolean, today: string, nowMs: number): DevotionWriteResult {
  if (!DATE.test(taskDate)) return { error: 'INVALID_DATE' };
  if (!isWithinCompletionWindow(taskDate, today)) return { error: 'OUTSIDE_COMPLETION_WINDOW' };
  if (completed) db.prepare('INSERT OR IGNORE INTO devotion_completions(member_id, task_date, created_at) VALUES (?, ?, ?)').run(memberId, taskDate, nowMs);
  else db.prepare('DELETE FROM devotion_completions WHERE member_id = ? AND task_date = ?').run(memberId, taskDate);
  return { taskDate, completed };
}

function readersByDate(db: DatabaseSync, from: string, to: string): Map<string, number> {
  const rows = db.prepare(`SELECT c.task_date AS task_date, COUNT(DISTINCT c.member_id) AS readers
    FROM completions c JOIN members m ON m.id = c.member_id
    WHERE c.status = 'COMPLETED' AND c.task_date >= ? AND c.task_date <= ? AND (m.disabled_at IS NULL OR m.disabled_at = 0)
    GROUP BY c.task_date`).all(from, to) as Array<{ task_date: string; readers: number }>;
  return new Map(rows.map((row) => [row.task_date, Number(row.readers)]));
}

function qualifiedMembers(db: DatabaseSync, month: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS qualified FROM (
      SELECT c.member_id FROM completions c JOIN members m ON m.id = c.member_id
      WHERE c.status = 'COMPLETED' AND c.task_date >= ? AND c.task_date <= ? AND (m.disabled_at IS NULL OR m.disabled_at = 0)
      GROUP BY c.member_id HAVING COUNT(DISTINCT c.task_date) >= ?)`).get(`${month}-01`, monthEnd(month), QUALIFYING_DAYS_PER_MONTH) as { qualified: number };
  return Number(row.qualified);
}

function memberReadingDays(db: DatabaseSync, memberId: string, month: string): number {
  const row = db.prepare(`SELECT COUNT(DISTINCT task_date) AS days FROM completions
    WHERE member_id = ? AND status = 'COMPLETED' AND task_date >= ? AND task_date <= ?`).get(memberId, `${month}-01`, monthEnd(month)) as { days: number };
  return Number(row.days);
}

const shown = (readers: number | undefined): number | null => readers !== undefined && readers >= MIN_GROUP_READERS ? readers : null;

export interface GroupReadingView {
  month: string;
  today: string;
  /** Null under MIN_GROUP_READERS. */
  todayReaders: number | null;
  yesterdayReaders: number | null;
  /** Every day of the month up to today; later days are not listed. */
  days: Array<{ date: string; readers: number | null }>;
  /** Reads added up over the shown days (人次). */
  monthReads: number;
  busiest: { date: string; readers: number } | null;
  qualifyingDays: number;
  prizes: Array<GroupPrize & { qualifiedThisMonth: number; achievedMonths: number }>;
  /** The viewer's reading days this calendar month (prizes are always about the current month). */
  myDaysThisMonth: number;
}

export function getGroupReading(db: DatabaseSync, memberId: string, month: string, today: string): GroupReadingView | null {
  if (!MONTH.test(month) || month > today.slice(0, 7)) return null;
  const last = month === today.slice(0, 7) ? today : monthEnd(month);
  const counts = readersByDate(db, `${month}-01`, last);
  const days: GroupReadingView['days'] = [];
  for (let date = `${month}-01`; date <= last; date = shiftDate(date, 1)) days.push({ date, readers: shown(counts.get(date)) });
  const visible = days.filter((day): day is { date: string; readers: number } => day.readers !== null);
  const busiest = visible.reduce<{ date: string; readers: number } | null>((best, day) => !best || day.readers > best.readers ? day : best, null);
  const around = readersByDate(db, shiftDate(today, -1), today);
  const currentMonth = today.slice(0, 7);
  const qualifiedNow = qualifiedMembers(db, currentMonth);
  const qualifiedByMonth: number[] = [];
  for (let value = GROUP_PRIZES_FROM; value <= currentMonth; value = nextMonth(value)) qualifiedByMonth.push(value === currentMonth ? qualifiedNow : qualifiedMembers(db, value));
  return {
    month,
    today,
    todayReaders: shown(around.get(today)),
    yesterdayReaders: shown(around.get(shiftDate(today, -1))),
    days,
    monthReads: visible.reduce((total, day) => total + day.readers, 0),
    busiest,
    qualifyingDays: QUALIFYING_DAYS_PER_MONTH,
    prizes: GROUP_PRIZES.map((prize) => ({
      ...prize,
      qualifiedThisMonth: qualifiedNow,
      achievedMonths: Math.min(prize.months, qualifiedByMonth.filter((qualified) => qualified >= prize.members).length),
    })),
    myDaysThisMonth: memberReadingDays(db, memberId, currentMonth),
  };
}

export interface ScoreHistoryView {
  /** The plan's first day, or null before it has started. */
  from: string | null;
  today: string;
  /** One value per day from `from` to today: points earned up to and including that day. */
  points: number[];
  /** One value per day: 靈修 days up to and including that day. */
  devotions: number[];
  months: Array<{ month: string; points: number; devotionDays: number }>;
}

export function getScoreHistory(db: DatabaseSync, memberId: string, today: string): ScoreHistoryView {
  const first = (db.prepare('SELECT MIN(task_date) AS first FROM reading_days WHERE task_date <= ?').get(today) as { first: string | null } | undefined)?.first ?? null;
  if (!first) return { from: null, today, points: [], devotions: [], months: [] };
  const earned = new Map((db.prepare(`SELECT task_date, COALESCE(SUM(amount), 0) AS total FROM daily_point_entitlements
    WHERE member_id = ? AND active = 1 AND task_date <= ? GROUP BY task_date`).all(memberId, today) as Array<{ task_date: string; total: number }>)
    .map((row) => [row.task_date, Math.max(0, Number(row.total))]));
  const devoted = new Set(listDevotionDates(db, memberId, first, today) ?? []);
  let points = [...earned].filter(([date]) => date < first).reduce((total, [, amount]) => total + amount, 0);
  let devotions = 0;
  const pointSeries: number[] = [];
  const devotionSeries: number[] = [];
  const months = new Map<string, { points: number; devotionDays: number }>();
  for (let date = first; date <= today; date = shiftDate(date, 1)) {
    const dayPoints = earned.get(date) ?? 0;
    points += dayPoints;
    if (devoted.has(date)) devotions += 1;
    pointSeries.push(points);
    devotionSeries.push(devotions);
    const month = months.get(date.slice(0, 7)) ?? { points: 0, devotionDays: 0 };
    month.points += dayPoints;
    if (devoted.has(date)) month.devotionDays += 1;
    months.set(date.slice(0, 7), month);
  }
  return { from: first, today, points: pointSeries, devotions: devotionSeries, months: [...months].map(([month, value]) => ({ month, ...value })) };
}
