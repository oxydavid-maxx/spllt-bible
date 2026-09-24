import { useSyncExternalStore } from 'react';
import { canonicalSeptemberPlan, getAdjacentScheduledDates, getInitialReadingDate, getPeriodForDate, getReadingDay } from '../domain/calendar';
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
  return getInitialReadingDate(canonicalSeptemberPlan, todayInTaipei());
}

let activePlan: ReadingPlanSnapshot = canonicalSeptemberPlan;
let planIdByDate = new Map(canonicalSeptemberPlan.days.map((day) => [day.date, canonicalSeptemberPlan.planId]));
let selectedDate = initialDate();
let snapshotRevision = 0;
let todayReaderTabPressRevision = 0;
let todayReaderTabPressMemberId: string | null = null;
let todayReaderTabPressAuthEpoch = 0;
let todayReaderTabPressSameDate = false;
let todayReaderTabPressTargetDate: string | null = null;
let journalEntryDate: string | null = null;
let journalEntryRevision = 0;
let pendingJournalQuote: string | null = null;

export function setSelectedReadingDate(date: string): void {
  if (!validDateOnly(date) || date === selectedDate) return;
  selectedDate = date;
  if (todayReaderTabPressTargetDate && todayReaderTabPressTargetDate !== date) todayReaderTabPressTargetDate = null;
  publish();
}

/** An explicit tap on the visible Reader tab is an entry action even when today is already selected. */
export function requestTodayReaderTabPress(date: string, memberId: string | null, authEpoch: number): void {
  if (!validDateOnly(date)) return;
  todayReaderTabPressSameDate = selectedDate === date;
  selectedDate = date;
  todayReaderTabPressRevision += 1;
  todayReaderTabPressMemberId = memberId;
  todayReaderTabPressAuthEpoch = authEpoch;
  todayReaderTabPressTargetDate = date;
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
  planIdByDate = new Map(activePlan.days.map((day) => [day.date, day.planId ?? activePlan.planId]));
  if (!getReadingDay(activePlan, selectedDate)) {
    const fallbackDate = activePlan.days[0]?.date ?? selectedDate;
    if (fallbackDate !== selectedDate && todayReaderTabPressTargetDate && todayReaderTabPressTargetDate !== fallbackDate) todayReaderTabPressTargetDate = null;
    selectedDate = fallbackDate;
  }
  publish();
}

/** Merge a server schedule while preserving old dates and their original plan IDs. */
export function mergeReadingPlan(plan: ReadingPlanSnapshot): void {
  const byDate = new Map(activePlan.days.map((day) => [day.date, day]));
  for (const day of plan.days) {
    byDate.set(day.date, day);
    planIdByDate.set(day.date, day.planId ?? plan.planId);
  }
  const days = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  activePlan = normalizePlan({ ...activePlan, planId: plan.planId, timezone: plan.timezone, days, dates: days.map((day) => day.date), uniqueReferences: [...new Set(days.flatMap((day) => day.references))] });
  publish();
}

export function resetReadingPlan(): void {
  activePlan = canonicalSeptemberPlan;
  planIdByDate = new Map(canonicalSeptemberPlan.days.map((day) => [day.date, canonicalSeptemberPlan.planId]));
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
  return { selectedDate, planId: planIdByDate.get(selectedDate) ?? activePlan.planId, day, period, previousDate: adjacent.previous, nextDate: adjacent.next, todayReaderTabPressRevision, todayReaderTabPressMemberId, todayReaderTabPressAuthEpoch, todayReaderTabPressSameDate, todayReaderTabPressTargetDate, journalEntryDate, journalEntryRevision, pendingJournalQuote };
}

export function getReadingPlanId(taskDate: string): string | null {
  return planIdByDate.get(taskDate) ?? null;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingSession() {
  useSyncExternalStore(subscribe, () => snapshotRevision, () => snapshotRevision);
  return getReadingSessionSnapshot();
}
