import { useEffect, useSyncExternalStore } from 'react';
import { canonicalReadingPlan, getAdjacentScheduledDates, getInitialReadingDate, getPeriodForDate, getReadingDay } from '../domain/calendar';
import type { ReadingDaySnapshot } from '../services/apiClient';
import type { ReadingPlan } from '../domain/types';

export interface ReadingPlanSnapshot extends ReadingPlan {
  timezone: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function todayInTaipei(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

function initialDate(): string {
  const configured = process.env.EXPO_PUBLIC_QINGMU_TEST_DATE?.trim();
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) return configured;
  return getInitialReadingDate(canonicalReadingPlan, todayInTaipei());
}

let activePlan: ReadingPlanSnapshot = canonicalReadingPlan;
let planIdByDate = new Map(canonicalReadingPlan.days.map((day) => [day.date, canonicalReadingPlan.planId]));
let knownPlanMonths = new Set(canonicalReadingPlan.dates.map(date => date.slice(0, 7)));
let selectedDate = initialDate();
let followsToday = true;
let selectionDay = readingToday();
let deferDateUntilAudioEnds = false;
function readingToday(): string {
  const configured = process.env.EXPO_PUBLIC_QINGMU_TEST_DATE?.trim();
  return configured && validDateOnly(configured) ? configured : todayInTaipei();
}
function refreshVisibleDate(playing: boolean, finished: boolean): void {
  if (!followsToday) return;
  const today = readingToday();
  // Initial entry may clamp to the bundled plan, but an actual day rollover must
  // reach today so the reader can discover a newly added server month.
  if (today === selectionDay) return;
  if (today === selectedDate) { selectionDay = today; return; }
  if (playing) { deferDateUntilAudioEnds = true; return; }
  if (deferDateUntilAudioEnds && !finished) return;
  deferDateUntilAudioEnds = false;
  selectedDate = today; selectionDay = today;
  publish();
}
let snapshotRevision = 0;
let todayReaderTabPressRevision = 0;
let todayReaderTabPressMemberId: string | null = null;
let todayReaderTabPressAuthEpoch = 0;
let todayReaderTabPressSameDate = false;
let todayReaderTabPressTargetDate: string | null = null;
let todayReaderTabPressResetToAssignedStart = false;
let journalEntryDate: string | null = null;
let journalEntryRevision = 0;
let pendingJournalQuote: string | null = null;

export function setSelectedReadingDate(date: string): void {
  if (!validDateOnly(date)) return;
  selectionDay = readingToday();
  followsToday = date === selectionDay;
  deferDateUntilAudioEnds = false;
  if (date === selectedDate) return;
  selectedDate = date;
  if (todayReaderTabPressTargetDate && todayReaderTabPressTargetDate !== date) {
    todayReaderTabPressTargetDate = null;
    todayReaderTabPressResetToAssignedStart = false;
  }
  publish();
}

/** A cross-midnight return must not erase a historical choice or paused narration. */
export function preserveReadingDateOnReturn(): boolean {
  return deferDateUntilAudioEnds || (!followsToday && selectionDay !== readingToday());
}

/** An explicit tap on the visible Reader tab is an entry action even when today is already selected. */
export function requestTodayReaderTabPress(date: string, memberId: string | null, authEpoch: number, resetToAssignedStart = false): void {
  if (!validDateOnly(date)) return;
  followsToday = true; selectionDay = readingToday(); deferDateUntilAudioEnds = false;
  todayReaderTabPressSameDate = selectedDate === date;
  selectedDate = date;
  todayReaderTabPressRevision += 1;
  todayReaderTabPressMemberId = memberId;
  todayReaderTabPressAuthEpoch = authEpoch;
  todayReaderTabPressTargetDate = date;
  todayReaderTabPressResetToAssignedStart = resetToAssignedStart;
  publish();
}

/** A journal tab entry borrows the current Reader task date without changing Reader selection. */
export function setJournalEntryDate(date: string): void {
  if (!validDateOnly(date)) return;
  journalEntryDate = date;
  journalEntryRevision += 1;
  publish();
}

export function setPendingJournalQuote(quote: string): void {
  const next = quote.trim();
  if (!next || next === pendingJournalQuote) return;
  pendingJournalQuote = next;
  publish();
}

export function consumePendingJournalQuote(): void {
  if (pendingJournalQuote === null) return;
  pendingJournalQuote = null;
  publish();
}

function publish(): void {
  snapshotRevision += 1;
  listeners.forEach((listener) => listener());
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Replace the active schedule, used by focused tests and a plan switch. */
export function setReadingPlan(plan: ReadingPlanSnapshot): void {
  activePlan = normalizePlan(plan);
  knownPlanMonths = new Set(activePlan.dates.map(date => date.slice(0, 7)));
  planIdByDate = new Map(activePlan.days.map((day) => [day.date, day.planId ?? activePlan.planId]));
  if (!getReadingDay(activePlan, selectedDate)) {
    const fallbackDate = activePlan.days[0]?.date ?? selectedDate;
    if (fallbackDate !== selectedDate && todayReaderTabPressTargetDate && todayReaderTabPressTargetDate !== fallbackDate) {
      todayReaderTabPressTargetDate = null;
      todayReaderTabPressResetToAssignedStart = false;
    }
    selectedDate = fallbackDate;
  }
  publish();
}

/** A successful server range replaces that range, including dates removed by the server.
 * Keep the selected date even when it becomes a rest day; never resurrect bundled passages. */
export function replaceReadingDaysRange(from: string, to: string, days: ReadingDaySnapshot[]): void {
  // A known month remains a query scope even when its authoritative answer is empty.
  // Otherwise deleting its last day would prevent this app from ever seeing restored dates.
  for (let month = from.slice(0, 7); month <= to.slice(0, 7);) {
    knownPlanMonths.add(month);
    const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
    month = next.toISOString().slice(0, 7);
  }
  const byDate = new Map(activePlan.days.filter(day => day.date < from || day.date > to).map(day => [day.date, day]));
  for (const day of days) {
    if (day.taskDate < from || day.taskDate > to) continue;
    byDate.set(day.taskDate, { date: day.taskDate, planId: day.planId, sourceRows: [], references: [...day.references], revision: day.sourceRevision });
  }
  activePlan = normalizePlan({ ...activePlan, days: [...byDate.values()] });
  planIdByDate = new Map(activePlan.days.map(day => [day.date, day.planId ?? activePlan.planId]));
  publish();
}

/** Merge a server schedule while preserving old dates and their original plan IDs. */
export function mergeReadingPlan(plan: ReadingPlanSnapshot): void {
  const byDate = new Map(activePlan.days.map((day) => [day.date, day]));
  for (const day of plan.days) {
    knownPlanMonths.add(day.date.slice(0, 7));
    byDate.set(day.date, day);
    planIdByDate.set(day.date, day.planId ?? plan.planId);
  }
  const days = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  activePlan = normalizePlan({ ...activePlan, planId: plan.planId, timezone: plan.timezone, days, dates: days.map((day) => day.date), uniqueReferences: [...new Set(days.flatMap((day) => day.references))] });
  publish();
}

export function resetReadingPlan(): void {
  activePlan = canonicalReadingPlan;
  knownPlanMonths = new Set(canonicalReadingPlan.dates.map(date => date.slice(0, 7)));
  planIdByDate = new Map(canonicalReadingPlan.days.map((day) => [day.date, canonicalReadingPlan.planId]));
  publish();
}

function normalizePlan(plan: ReadingPlanSnapshot): ReadingPlanSnapshot {
  const days = [...plan.days].sort((left, right) => left.date.localeCompare(right.date));
  return { ...plan, days, dates: days.map((day) => day.date), uniqueReferences: [...new Set(days.flatMap((day) => day.references))] };
}

export function getReadingSessionSnapshot() {
  const day = getReadingDay(activePlan, selectedDate);
  const period = getPeriodForDate(activePlan, selectedDate);
  const adjacent = getAdjacentScheduledDates(activePlan, selectedDate);
  return { selectedDate, planId: planIdByDate.get(selectedDate) ?? activePlan.planId, day, period, previousDate: adjacent.previous, nextDate: adjacent.next, todayReaderTabPressRevision, todayReaderTabPressMemberId, todayReaderTabPressAuthEpoch, todayReaderTabPressSameDate, todayReaderTabPressTargetDate, todayReaderTabPressResetToAssignedStart, journalEntryDate, journalEntryRevision, pendingJournalQuote };
}

export function getReadingPlanId(taskDate: string): string | null {
  return planIdByDate.get(taskDate) ?? null;
}

/** The full active schedule shared by the reader and the plan sheet. */
export function getReadingPlan(): ReadingPlanSnapshot {
  return activePlan;
}

/** Query scopes include months that the server has emptied, so a later entry can discover additions. */
export function getReadingPlanMonths(): string[] { return [...knownPlanMonths].sort(); }

/** First and last scheduled dates of the active plan: the months there is anything to show. */
export function getReadingPlanSpan(): { first: string; last: string } | null {
  return activePlan.dates.length > 0 ? { first: activePlan.dates[0], last: activePlan.dates[activePlan.dates.length - 1] } : null;
}

/** A scheduled day from the plan the reading tab reads, for screens that name it the same way. */
export function getScheduledReading(taskDate: string): { planId: string; references: string[]; note?: string } | null {
  const day = getReadingDay(activePlan, taskDate);
  return day ? { planId: planIdByDate.get(taskDate) ?? activePlan.planId, references: [...day.references], ...(day.note ? { note: day.note } : {}) } : null;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingSession(visibility?: { visible: boolean; playing: boolean; finished?: boolean }) {
  const visible = visibility?.visible ?? false;
  const playing = visibility?.playing ?? false;
  const finished = visibility?.finished ?? false;
  useEffect(() => {
    if (!visible) return;
    refreshVisibleDate(playing, finished);
    let alive = true; let stop: (() => void) | undefined;
    // Keep the calendar/session module usable by Node tools and pure model tests.
    void import('../services/appVisibility').then(({ subscribeAppActive }) => {
      if (alive) stop = subscribeAppActive(() => refreshVisibleDate(playing, finished));
    });
    return () => { alive = false; stop?.(); };
  }, [visible, playing, finished]);
  useSyncExternalStore(subscribe, () => snapshotRevision, () => snapshotRevision);
  return getReadingSessionSnapshot();
}
