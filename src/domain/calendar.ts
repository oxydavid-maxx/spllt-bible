import type { ReadingDay, ReadingPlan } from './types';
import septemberCalendar from '../../data/september-2026.json';
import readingPlan2026 from '../../data/reading-plan-2026.json';

interface CalendarInput {
  plan_id?: string;
  timezone?: string;
  days?: Array<{
    date?: string;
    source_rows?: unknown;
    references?: unknown;
  }>;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/** The September design fixture (data/september-2026.json), which focused tests still build plans from. */
export function loadSeptemberPlan(raw: unknown): ReadingPlan {
  const plan = loadReadingPlan(raw);
  const outside = plan.dates.findIndex((date) => !/^2026-09-\d{2}$/.test(date));
  if (outside >= 0) throw new Error(`invalid September date at index ${outside}`);
  return plan;
}

export function loadReadingPlan(raw: unknown): ReadingPlan {
  const input = raw as CalendarInput;
  if (!input || !Array.isArray(input.days)) throw new Error('calendar must contain days');

  const days: ReadingDay[] = input.days.map((day, index) => {
    if (!day || typeof day.date !== 'string' || !isDateOnly(day.date)) {
      throw new Error(`invalid date at index ${index}`);
    }
    return {
      date: day.date,
      sourceRows: asStringArray(day.source_rows, 'source_rows'),
      references: asStringArray(day.references, 'references'),
    };
  });

  const dates = days.map((day) => day.date);
  if (new Set(dates).size !== dates.length) throw new Error('calendar contains duplicate dates');
  const uniqueReferences = [...new Set(days.flatMap((day) => day.references))];

  return {
    planId: input.plan_id ?? 'church-2026-09',
    timezone: input.timezone ?? 'Asia/Taipei',
    days,
    dates,
    uniqueReferences,
  };
}

export const canonicalSeptemberPlan = loadSeptemberPlan(septemberCalendar);

/** The plan the app and server run on: September, then the church sheet through 12/31 (data/reading-plan-2026.json). */
export const canonicalReadingPlan = loadReadingPlan(readingPlan2026);

export function getReadingDay(plan: ReadingPlan, date: string): ReadingDay | undefined {
  return plan.days.find((day) => day.date === date);
}

/**
 * Today when it falls inside the plan's months, scheduled or not (a Sunday shows that there is no task);
 * otherwise the plan's first or last day. Only September used to count, so 10/1 opened on 9/1.
 */
export function getInitialReadingDate(plan: ReadingPlan, candidate: string): string {
  const first = plan.dates[0];
  const last = plan.dates[plan.dates.length - 1];
  if (!first || !last) return candidate;
  if (candidate < `${first.slice(0, 7)}-01`) return first;
  if (candidate.slice(0, 7) > last.slice(0, 7)) return last;
  return candidate;
}

export function getAdjacentScheduledDates(plan: ReadingPlan, date: string): { previous?: string; next?: string } {
  return {
    previous: [...plan.dates].reverse().find((scheduledDate) => scheduledDate < date),
    next: plan.dates.find((scheduledDate) => scheduledDate > date),
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getPeriodForDate(plan: ReadingPlan, date: string): { start: string; end: string; dates: string[] } {
  const selected = new Date(`${date}T12:00:00Z`);
  const dayOfWeek = selected.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startDate = new Date(selected);
  startDate.setUTCDate(selected.getUTCDate() - daysFromMonday);
  const start = isoDate(startDate);
  const dates = plan.days
    .map((day) => day.date)
    .filter((scheduledDate) => scheduledDate >= start && scheduledDate <= date);
  return { start, end: date, dates };
}
