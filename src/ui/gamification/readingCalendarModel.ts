import { COMPLETION_WINDOW_DAYS, isWithinCompletionWindow } from '../../domain/gamificationV1';

/**
 * The member's own reading calendar at the top of 積分: which days had a reading, which are done,
 * and what the selected day allows. The days come from the account's reading-days schedule, never
 * from the trend chart below it, so moving that chart to 年 cannot change what the calendar shows.
 */

export interface CalendarDay {
  planId: string;
  references: string[];
  completed: boolean;
  /** The schedule's own answer for the 7-day window, as of the server's today. */
  canComplete: boolean;
}

export type CalendarDays = ReadonlyMap<string, CalendarDay>;

/** open: can be completed now. completed: done, undo lives here. The rest are one line of text. */
export type DayState = 'open' | 'completed' | 'expired' | 'rest' | 'future';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function utcNoon(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const value = utcNoon(date);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function daysIn(month: string): number {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0, 12)).getUTCDate();
}

export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, value - 1 + delta, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 9/25（五）: how the page names a day, in the heading and in every one-line message. */
export function dayHeading(date: string): string {
  const value = utcNoon(date);
  return `${value.getUTCMonth() + 1}/${value.getUTCDate()}（${WEEKDAYS[value.getUTCDay()]}）`;
}

export function dayState(date: string, today: string, day: CalendarDay | undefined): DayState {
  if (date > today) return 'future';
  if (!day) return 'rest';
  if (day.completed) return 'completed';
  return isWithinCompletionWindow(date, today) && day.canComplete ? 'open' : 'expired';
}

/** The whole panel for a day that has no button: one line, the date first. */
export function dayMessage(date: string, state: DayState): string | null {
  if (state === 'expired') return `${dayHeading(date)}已超過 ${COMPLETION_WINDOW_DAYS} 天，不能補登`;
  if (state === 'rest') return `${dayHeading(date)}這天沒有讀經`;
  if (state === 'future') return `${dayHeading(date)}還沒到，當天再來打卡`;
  return null;
}

/**
 * Today when today has a reading, so the daily tap is still the first thing on the page. Otherwise
 * the most recent day in the window still waiting (a Sunday lands on Saturday, or on Friday if
 * Saturday is done), and today again when nothing is waiting.
 */
export function defaultSelectedDate(today: string, days: CalendarDays): string {
  if (days.has(today)) return today;
  for (let age = 1; age < COMPLETION_WINDOW_DAYS; age += 1) {
    const date = shiftDate(today, -age);
    const day = days.get(date);
    if (day && !day.completed) return date;
  }
  return today;
}

/** The month as grid slots, Sunday first (光佑 2026-09-27): null for the blanks before the 1st. */
export function monthCells(month: string): Array<string | null> {
  const first = utcNoon(`${month}-01`);
  const blanks = first.getUTCDay();
  const dates = Array.from({ length: daysIn(month) }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  return [...Array.from({ length: blanks }, () => null), ...dates];
}

/**
 * The reading-days range for a month. The current month also reaches back over the completion
 * window, so on 10/3 the default can still land on an unfinished 9/29.
 */
export function readingDaysRange(month: string, today: string): { from: string; to: string } {
  const from = `${month}-01`;
  const to = `${month}-${String(daysIn(month)).padStart(2, '0')}`;
  if (month !== today.slice(0, 7)) return { from, to };
  const windowStart = shiftDate(today, -(COMPLETION_WINDOW_DAYS - 1));
  return { from: windowStart < from ? windowStart : from, to };
}
