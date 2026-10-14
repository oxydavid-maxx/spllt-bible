import type { ScoreHistory } from '../../services/devotionClient';

/**
 * Geometry for the 積分 page's one chart (維護者 2026-10-14). 總積分: the running reading points from
 * the plan's first day, with the running 靈修 days as a gold dashed line on the same scale. 每月: one
 * green bar per month, with a gold dashed line across it at that month's 靈修 days and the number in
 * the middle of the line.
 */

export const TOTAL_BOX = { width: 330, height: 156, left: 26, right: 322, top: 34, bottom: 130 } as const;
export const MONTHLY_BOX = { width: 330, height: 140, baseline: 112, tallest: 84, barWidth: 44, center: 165, maxSpacing: 120, span: 290 } as const;

/** An even top so the middle grid line is a whole number. */
export function niceTop(max: number): number {
  if (max <= 2) return 2;
  return Math.ceil(max / 2) * 2;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export interface TotalChart {
  top: number;
  points: string;
  devotions: string;
  end: { x: number; y: number };
  /** Month starts between the first day and today, far enough from both ends to be read. */
  monthTicks: Array<{ x: number; label: string }>;
  pointsTotal: number;
  devotionsTotal: number;
}

export function totalChart(history: ScoreHistory): TotalChart | null {
  if (!history.from || history.points.length === 0) return null;
  const count = history.points.length;
  const top = niceTop(Math.max(...history.points, ...history.devotions));
  const x = (index: number) => count === 1 ? (TOTAL_BOX.left + TOTAL_BOX.right) / 2 : TOTAL_BOX.left + index * (TOTAL_BOX.right - TOTAL_BOX.left) / (count - 1);
  const y = (value: number) => TOTAL_BOX.bottom - value / top * (TOTAL_BOX.bottom - TOTAL_BOX.top);
  const line = (values: number[]) => values.map((value, index) => `${round(x(index))},${round(y(value))}`).join(' ');
  const monthTicks: TotalChart['monthTicks'] = [];
  for (let index = 1; index < count; index += 1) {
    const date = shiftDate(history.from, index);
    const at = x(index);
    if (date.slice(8, 10) === '01' && at - TOTAL_BOX.left >= 40 && TOTAL_BOX.right - at >= 40) monthTicks.push({ x: round(at), label: `${Number(date.slice(5, 7))}/1` });
  }
  const last = count - 1;
  return {
    top,
    points: line(history.points),
    devotions: line(history.devotions),
    end: { x: round(x(last)), y: round(y(history.points[last])) },
    monthTicks,
    pointsTotal: history.points[last],
    devotionsTotal: history.devotions[last],
  };
}

export interface MonthBar {
  month: string;
  label: string;
  current: boolean;
  x: number;
  top: number;
  points: number;
  /** Null when there were no 靈修 days that month. */
  devotion: { y: number; days: number; onBar: boolean } | null;
}

/** The last four months at most: four bars still fit a phone without crowding the labels. */
export function monthBars(history: ScoreHistory): MonthBar[] {
  const months = history.months.slice(-4);
  if (months.length === 0) return [];
  const tallest = Math.max(1, ...months.map((month) => Math.max(month.points, month.devotionDays)));
  const spacing = Math.min(MONTHLY_BOX.maxSpacing, MONTHLY_BOX.span / months.length);
  const height = (value: number) => value / tallest * MONTHLY_BOX.tallest;
  const currentMonth = history.today.slice(0, 7);
  return months.map((month, index) => {
    const center = MONTHLY_BOX.center + (index - (months.length - 1) / 2) * spacing;
    const top = MONTHLY_BOX.baseline - height(month.points);
    const devotionY = MONTHLY_BOX.baseline - height(month.devotionDays);
    return {
      month: month.month,
      label: `${Number(month.month.slice(5, 7))} 月`,
      current: month.month === currentMonth,
      x: round(center - MONTHLY_BOX.barWidth / 2),
      top: round(top),
      points: month.points,
      devotion: month.devotionDays > 0 ? { y: round(devotionY), days: month.devotionDays, onBar: devotionY >= top + 6 } : null,
    };
  });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
