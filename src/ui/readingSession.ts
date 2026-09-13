import { useSyncExternalStore } from 'react';
import { canonicalSeptemberPlan, getAdjacentScheduledDates, getInitialReadingDate, getPeriodForDate, getReadingDay, isSeptemberDate } from '../domain/calendar';

type Listener = () => void;
const listeners = new Set<Listener>();

function todayInTaipei(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

function initialDate(): string {
  const configured = process.env.EXPO_PUBLIC_QINGMU_TEST_DATE?.trim();
  if (configured && isSeptemberDate(configured)) return configured;
  return getInitialReadingDate(canonicalSeptemberPlan, todayInTaipei());
}

let selectedDate = initialDate();

export function setSelectedReadingDate(date: string): void {
  if (!isSeptemberDate(date) || date === selectedDate) return;
  selectedDate = date;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingSession() {
  const date = useSyncExternalStore(subscribe, () => selectedDate, () => selectedDate);
  const day = getReadingDay(canonicalSeptemberPlan, date);
  const period = getPeriodForDate(canonicalSeptemberPlan, date);
  const adjacent = getAdjacentScheduledDates(canonicalSeptemberPlan, date);
  return {
    selectedDate: date,
    day,
    period,
    previousDate: adjacent.previous,
    nextDate: adjacent.next,
  };
}
