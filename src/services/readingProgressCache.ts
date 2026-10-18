import type { ReadingDaySnapshot } from './apiClient';

export interface CachedReadingProgress { days: Record<string, ReadingDaySnapshot>; devotionDates: string[]; ranges?: Array<{ from: string; to: string }>; }
interface Storage { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void>; }
const empty = (): CachedReadingProgress => ({ days: {}, devotionDates: [] });

/** One file per account. Serial writes keep simultaneous reading/devotion responses from losing data. */
export function createReadingProgressCache(storage: Storage) {
  const queues = new Map<string, Promise<void>>();
  const key = (memberId: string) => `reading-progress-v1-${encodeURIComponent(memberId)}.json`;
  async function load(memberId: string): Promise<CachedReadingProgress> {
    const text = await storage.read(key(memberId));
    if (!text) return empty();
    try {
      const value = JSON.parse(text);
      if (value.version !== 1 || !value.days || typeof value.days !== 'object' || Array.isArray(value.days) || !Array.isArray(value.devotionDates)) return empty();
      const days = Object.fromEntries(Object.entries(value.days).filter(([date, raw]) => {
        const day = raw as ReadingDaySnapshot | null;
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && day?.taskDate === date && typeof day.planId === 'string' && Array.isArray(day.references) && day.references.every(ref => typeof ref === 'string') && ['UNREPORTED', 'NOT_COMPLETED', 'COMPLETED'].includes(day.status) && Number.isInteger(day.revision);
      })) as Record<string, ReadingDaySnapshot>;
      const ranges = Array.isArray(value.ranges) ? value.ranges.filter((range: { from?: unknown; to?: unknown } | null) => range && typeof range.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(range.from) && typeof range.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to) : [];
      return { days, ranges, devotionDates: value.devotionDates.filter((date: unknown) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) };
    } catch { return empty(); }
  }
  function update(memberId: string, mutate: (snapshot: CachedReadingProgress) => void): Promise<void> {
    const next = (queues.get(memberId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const snapshot = await load(memberId);
      mutate(snapshot);
      await storage.write(key(memberId), JSON.stringify({ version: 1, ...snapshot }));
    });
    queues.set(memberId, next);
    void next.finally(() => { if (queues.get(memberId) === next) queues.delete(memberId); }).catch(() => undefined);
    return next;
  }
  return {
    async read(memberId: string) { await queues.get(memberId)?.catch(() => undefined); return load(memberId); },
    saveDays(memberId: string, from: string, to: string, days: readonly ReadingDaySnapshot[]) {
      return update(memberId, snapshot => {
        for (const date of Object.keys(snapshot.days)) if (date >= from && date <= to) delete snapshot.days[date];
        for (const day of days) if (day.taskDate >= from && day.taskDate <= to) snapshot.days[day.taskDate] = day;
        snapshot.ranges = [...(snapshot.ranges ?? []).filter(range => range.from !== from || range.to !== to), { from, to }];
      });
    },
    saveDevotions(memberId: string, from: string, to: string, dates: readonly string[]) {
      return update(memberId, snapshot => { snapshot.devotionDates = [...new Set([...snapshot.devotionDates.filter(date => date < from || date > to), ...dates.filter(date => date >= from && date <= to)])]; });
    },
    setDevotion(memberId: string, date: string, completed: boolean) {
      return update(memberId, snapshot => { const dates = new Set(snapshot.devotionDates); if (completed) dates.add(date); else dates.delete(date); snapshot.devotionDates = [...dates]; });
    },
  };
}

// The same legacy file API as journalShare. Loaded only for progress I/O, never at screen import.
export const readingProgressCache = createReadingProgressCache({
  async read(key) {
    const fs = await import('expo-file-system/legacy');
    if (!fs.documentDirectory) return null;
    const uri = `${fs.documentDirectory}${key}`;
    if (!(await fs.getInfoAsync(uri)).exists) return null;
    return fs.readAsStringAsync(uri);
  },
  async write(key, value) {
    const fs = await import('expo-file-system/legacy');
    if (!fs.documentDirectory) throw new Error('無法儲存讀經紀錄快取。');
    await fs.writeAsStringAsync(`${fs.documentDirectory}${key}`, value);
  },
});
