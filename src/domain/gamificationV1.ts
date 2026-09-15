export const GAMIFICATION_TIME_ZONE = 'Asia/Taipei';
export const COMPLETION_WINDOW_DAYS = 7;

export type ScoreScope = 'me' | 'friends' | 'all';

export interface MonthPoints {
  month: string;
  earnedPoints: number;
}

export type ScoreChartRange = 'week' | 'month' | 'year' | 'all';

export interface ScoreChartBucket {
  key: string;
  startDate: string;
  endDate: string;
  earnedPoints: number;
}

export interface ScoreChart {
  range: ScoreChartRange;
  anchor: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  earnedPoints: number;
  buckets: ScoreChartBucket[];
  previousAnchor: string | null;
  nextAnchor: string | null;
}

export interface ScoreChartQuery {
  range: ScoreChartRange;
  anchor?: string;
}

export interface PersonListItem {
  memberId: string;
  displayName: string;
  earnedTotal: number;
  rank?: number | null;
}

export interface ScoreProfile {
  memberId: string;
  displayName: string;
  earnedTotal: number;
  band: number | null;
  months: MonthPoints[];
  chart?: ScoreChart;
  private?: {
    redeemableBalance: number;
    targetReward: {
      rewardId: string;
      name: string;
      costPoints: number;
      active: boolean;
      revision: number;
    } | null;
  };
  permissions: {
    canEditTarget: boolean;
    canRedeem: boolean;
  };
}

export interface ViewerCapabilities {
  canViewAllScores: boolean;
  canManageRewards: boolean;
  canRedeemRewards: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function parseDateOnly(value: string): Date {
  if (!DATE_PATTERN.test(value)) throw new Error('INVALID_DATE');
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('INVALID_DATE');
  return parsed;
}

export function isValidDateOnly(value: string): boolean {
  try { parseDateOnly(value); return true; } catch { return false; }
}

export function isWithinCompletionWindow(taskDate: string, taipeiToday: string): boolean {
  const task = parseDateOnly(taskDate);
  const today = parseDateOnly(taipeiToday);
  const age = Math.round((today.getTime() - task.getTime()) / 86_400_000);
  return age >= 0 && age < COMPLETION_WINDOW_DAYS;
}

export function taipeiDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: GAMIFICATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function calculateBand(total: number, totals: readonly number[]): number | null {
  const effectiveTotals = totals.filter((value) => Number.isFinite(value) && value > 0);
  if (total <= 0 || effectiveTotals.length < 10) return null;
  const higher = effectiveTotals.filter((value) => value > total).length;
  return Math.min(5, 1 + Math.floor((5 * higher) / effectiveTotals.length));
}

export function monthBuckets(anchorMonth: string): string[] {
  if (!MONTH_PATTERN.test(anchorMonth)) throw new Error('INVALID_MONTH');
  const [year, month] = anchorMonth.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  if (Number.isNaN(cursor.getTime()) || cursor.getUTCMonth() !== month - 1) throw new Error('INVALID_MONTH');
  const result: string[] = [];
  for (let index = 5; index >= 0; index -= 1) {
    const value = new Date(Date.UTC(year, month - 1 - index, 1));
    result.push(`${value.getUTCFullYear().toString().padStart(4, '0')}-${(value.getUTCMonth() + 1).toString().padStart(2, '0')}`);
  }
  return result;
}

export function isScoreChartRange(value: unknown): value is ScoreChartRange {
  return value === 'week' || value === 'month' || value === 'year' || value === 'all';
}

export function canonicalMemberPair(first: string, second: string): { memberLow: string; memberHigh: string } | null {
  if (!first || !second || first === second) return null;
  return first < second
    ? { memberLow: first, memberHigh: second }
    : { memberLow: second, memberHigh: first };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
