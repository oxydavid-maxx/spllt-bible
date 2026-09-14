import { afterEach, describe, expect, it } from 'vitest';
import { getReadingSessionSnapshot, resetReadingPlan, setReadingPlan, setSelectedReadingDate } from '../../src/ui/readingSession';

afterEach(() => {
  resetReadingPlan();
  setSelectedReadingDate('2026-09-08');
});

describe('dynamic reading-day source', () => {
  it('allows a remote October schedule to flow from home selection into the reader day and plan id', () => {
    setReadingPlan({
      planId: 'church-2026-10',
      timezone: 'Asia/Taipei',
      days: [{ date: '2026-10-01', sourceRows: ['啟1章'], references: ['REV.1'] }],
      dates: ['2026-10-01'],
      uniqueReferences: ['REV.1'],
    });
    setSelectedReadingDate('2026-10-01');
    expect(getReadingSessionSnapshot()).toMatchObject({
      selectedDate: '2026-10-01',
      planId: 'church-2026-10',
      day: { date: '2026-10-01', references: ['REV.1'] },
    });
  });
});
