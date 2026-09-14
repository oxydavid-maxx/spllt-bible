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

export function setSelectedReadingDate(date: string): void {
  if (!validDateOnly(date) || date === selectedDate) return;
  selectedDate = date;
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
  if (!getReadingDay(activePlan, selectedDate)) selectedDate = activePlan.days[0]?.date ?? selectedDate;
  listeners.forEach((listener) => listener());
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
  listeners.forEach((listener) => listener());
}

export function resetReadingPlan(): void {
  activePlan = canonicalSeptemberPlan;
  planIdByDate = new Map(canonicalSeptemberPlan.days.map((day) => [day.date, canonicalSeptemberPlan.planId]));
  listeners.forEach((listener) => listener());
}

function normalizePlan(plan: ReadingPlanSnapshot): ReadingPlanSnapshot {
  const days = [...plan.days].sort((left, right) => left.date.localeCompare(right.date));
  return { ...plan, days, dates: days.map((day) => day.date), uniqueReferences: [...new Set(days.flatMap((day) => day.references))] };
}

export function getReadingSessionSnapshot() {
  const day = getReadingDay(activePlan, selectedDate);
  const period = getPeriodForDate(activePlan, selectedDate);
  const adjacent = getAdjacentScheduledDates(activePlan, selectedDate);
  return { selectedDate, planId: planIdByDate.get(selectedDate) ?? activePlan.planId, day, period, previousDate: adjacent.previous, nextDate: adjacent.next };
}

export function getReadingPlanId(taskDate: string): string | null {
  return planIdByDate.get(taskDate) ?? null;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingSession() {
  useSyncExternalStore(subscribe, () => selectedDate, () => selectedDate);
  return getReadingSessionSnapshot();
}
