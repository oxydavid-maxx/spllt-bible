import type { ReadingDay, ReadingPlan } from './types';
import septemberCalendar from '../../data/september-2026.json';

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

export function loadSeptemberPlan(raw: unknown): ReadingPlan {
  const input = raw as CalendarInput;
  if (!input || !Array.isArray(input.days)) throw new Error('calendar must contain days');

  const days: ReadingDay[] = input.days.map((day, index) => {
    if (!day || typeof day.date !== 'string' || !/^2026-09-\d{2}$/.test(day.date)) {
      throw new Error(`invalid September date at index ${index}`);
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

export function getReadingDay(plan: ReadingPlan, date: string): ReadingDay | undefined {
  return plan.days.find((day) => day.date === date);
}

export function isSeptemberDate(date: string): boolean {
  return /^2026-09-(0[1-9]|[12]\d|30)$/.test(date);
}

export function getInitialReadingDate(plan: ReadingPlan, candidate: string): string {
  if (isSeptemberDate(candidate)) return candidate;
  return plan.days[0]?.date ?? '2026-09-01';
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
