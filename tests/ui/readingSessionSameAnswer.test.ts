import { describe, expect, it } from 'vitest';
import type { ReadingDaySnapshot } from '../../src/services/apiClient';
import { getReadingPlan, replaceReadingDaysRange } from '../../src/ui/readingSession';

// 光佑 2026-10-23:「速度要完全無感非常的快」. The 積分 calendar hands every month it shows to the reading tab's plan; the
// same answer again (a month switched back to) must not make a new plan, which would draw the mounted reading tab again
// in the middle of the switch.
const day = (taskDate: string, references: string[]): ReadingDaySnapshot => ({ taskDate, planId: 'church-2026-10', references, sourceRevision: 3, sourceDigest: 'd', status: 'UNREPORTED', revision: 0, canComplete: false });

describe('the reading tab plan takes a month from the schedule', () => {
  it('keeps the same plan for the same answer, and takes a changed one', () => {
    replaceReadingDaysRange('2026-10-01', '2026-10-31', [day('2026-10-05', ['GEN.1']), day('2026-10-06', ['GEN.2'])]);
    const plan = getReadingPlan();
    replaceReadingDaysRange('2026-10-01', '2026-10-31', [day('2026-10-06', ['GEN.2']), day('2026-10-05', ['GEN.1'])]);
    expect(getReadingPlan()).toBe(plan);
    replaceReadingDaysRange('2026-10-01', '2026-10-31', [day('2026-10-05', ['GEN.1']), day('2026-10-06', ['GEN.3'])]);
    expect(getReadingPlan()).not.toBe(plan);
    expect(getReadingPlan().days.find((item) => item.date === '2026-10-06')?.references).toEqual(['GEN.3']);
  });
});
