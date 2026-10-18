import { describe, expect, it } from 'vitest';
import { createReadingProgressCache } from '../../src/services/readingProgressCache';
import { readingCardDays } from '../../src/services/readingCardSnapshot';
import type { ReadingDaySnapshot } from '../../src/services/apiClient';
import type { ReadingPlan } from '../../src/domain/types';

const remote = (taskDate: string, status: ReadingDaySnapshot['status'] = 'COMPLETED'): ReadingDaySnapshot => ({ taskDate, planId: 'p', references: ['JAS.1', 'PSA.107', 'PSA.108'], sourceRevision: 1, sourceDigest: 'digest', status, revision: 2, canComplete: false });
const plan: ReadingPlan = { planId: 'p', timezone: 'Asia/Taipei', days: [{ date: '2026-10-01', sourceRows: ['雅01章', '詩107-108'], references: ['JAS.1', 'PSA.107', 'PSA.108'] }], dates: ['2026-10-01'], uniqueReferences: [] };

describe('offline reading card snapshot', () => {
  it('persists range replacements, independent devotion changes and account isolation', async () => {
    const files = new Map<string, string>();
    const storage = { read: async (key: string) => files.get(key) ?? null, write: async (key: string, text: string) => { files.set(key, text); } };
    const cache = createReadingProgressCache(storage);
    await Promise.all([
      cache.saveDays('a', '2026-10-01', '2026-10-31', [remote('2026-10-01'), remote('2026-10-02')]),
      cache.saveDevotions('a', '2026-10-01', '2026-10-31', ['2026-10-01']),
      cache.setDevotion('a', '2026-09-30', true),
    ]);
    // New store simulates an app restart without a network connection.
    const restarted = createReadingProgressCache(storage);
    expect((await restarted.read('a')).devotionDates).toEqual(['2026-10-01', '2026-09-30']);
    expect(Object.keys((await restarted.read('a')).days)).toHaveLength(2);
    expect((await restarted.read('b')).days).toEqual({});
    await restarted.saveDays('a', '2026-10-01', '2026-10-31', [remote('2026-10-01', 'UNREPORTED')]);
    await restarted.setDevotion('a', '2026-10-01', false);
    expect(Object.keys((await restarted.read('a')).days)).toEqual(['2026-10-01']);
    expect((await restarted.read('a')).devotionDates).toEqual(['2026-09-30']);
    expect((await restarted.read('a')).days['2026-10-01'].status).toBe('UNREPORTED');
  });

  it('preserves source rows and applies pending undo over remote, with independent devotion', () => {
    const cached = { days: { '2026-10-01': remote('2026-10-01') }, devotionDates: ['2026-10-01'] };
    expect(readingCardDays(plan, cached, () => undefined)[0]).toEqual({ date: '2026-10-01', rows: ['雅01章', '詩107-108'], completed: true, devoted: true });
    const local = { memberId: 'a', planId: 'p', taskDate: '2026-10-01', status: 'UNREPORTED' as const, revision: 3, syncStatus: 'PENDING_SAVE' as const };
    expect(readingCardDays(plan, cached, () => local)[0].completed).toBe(false);
    expect(readingCardDays(plan, cached, () => ({ ...local, status: 'COMPLETED' }))[0].completed).toBe(true);
    expect(readingCardDays(plan, cached, () => ({ ...local, syncStatus: 'CONFIRMED', revision: 1 }))[0].completed).toBe(true);
  });

  it('uses local completions with no cached network data and rejects another plan record', () => {
    const empty = { days: {}, devotionDates: [] };
    const local = { memberId: 'a', planId: 'p', taskDate: '2026-10-01', status: 'COMPLETED' as const, revision: 1, syncStatus: 'CONFIRMED' as const };
    expect(readingCardDays(plan, empty, () => local)[0].completed).toBe(true);
    expect(readingCardDays(plan, { ...empty, days: { '2026-10-01': { ...remote('2026-10-01'), planId: 'old' } } }, () => undefined)[0].completed).toBe(false);
  });

  it('compacts corrected adjacent chapters into rows rather than dropping a fourth passage', () => {
    const corrected = { ...remote('2026-10-01'), references: ['ACT.1', 'ACT.2', 'ACT.3', 'PSA.119.89-176'] };
    const rows = readingCardDays(plan, { days: { '2026-10-01': corrected }, devotionDates: [] }, () => undefined)[0].rows;
    expect(rows).toEqual(['徒1-3', '詩119:89-176']);
  });

  it('keeps a fetched no-reading day empty offline instead of resurrecting the bundled plan', async () => {
    let saved: string | null = null;
    const cache = createReadingProgressCache({ read: async () => saved, write: async (_key, value) => { saved = value; } });
    await cache.saveDays('a', '2026-10-01', '2026-10-31', []);
    expect(readingCardDays(plan, await cache.read('a'), () => undefined)).toEqual([]);
  });
});
