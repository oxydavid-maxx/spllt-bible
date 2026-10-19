import { afterEach, describe, expect, it } from 'vitest';
import { buildReadingCardHtml } from '../../src/domain/readingCard';
import { readingCardDays } from '../../src/services/readingCardSnapshot';
import type { ReadingDaySnapshot } from '../../src/services/apiClient';
import { getReadingPlan, replaceReadingDaysRange, resetReadingPlan } from '../../src/ui/readingSession';

// 2026-10-19 (Pixel, 0.5.35 build 59): once the 積分 calendar had put the backend's reading days into the shared plan
// (#73), 匯出讀經卡 › 本月 said 「這段期間沒有排定讀經。」 — every replaced day carried sourceRows: [].
const day = (taskDate: string, references: string[]): ReadingDaySnapshot => ({ taskDate, planId: 'p', references, sourceRevision: 1, sourceDigest: 'd', status: 'COMPLETED', revision: 1, canComplete: false });

describe('the reading card after the calendar synced the reading days', () => {
  afterEach(() => resetReadingPlan());

  it('keeps the bundled wording for unchanged days and writes rows for days the backend added or corrected', () => {
    const bundled = getReadingPlan().days.find((entry) => entry.date === '2026-10-19')!;
    replaceReadingDaysRange('2026-10-01', '2026-10-31', [
      day('2026-10-19', [...bundled.references]),
      day('2026-10-20', ['ACT.1', 'ACT.2', 'PSA.123']),
    ]);
    const cached = { days: {}, devotionDates: [] };
    const days = readingCardDays(getReadingPlan(), cached, () => undefined);
    expect(days.find((entry) => entry.date === '2026-10-19')?.rows).toEqual(bundled.sourceRows);
    expect(days.find((entry) => entry.date === '2026-10-20')?.rows).toEqual(['徒1-2', '詩123']);
    expect(() => buildReadingCardHtml({ today: '2026-10-19', memberName: '光佑', scope: 'month', days })).not.toThrow();
  });
});
