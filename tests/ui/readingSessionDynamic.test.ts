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

// 維護者 2026-10-31 (選 A)：手機只留前後一天的經文。The reader is given the previous and next scheduled day to warm.
describe('the days next to the one on screen', () => {
  it('names the references of the previous and next scheduled day, skipping days with no reading', () => {
    setReadingPlan({
      planId: 'church-2026-10',
      timezone: 'Asia/Taipei',
      days: [
        { date: '2026-10-30', sourceRows: ['徒7'], references: ['ACT.7.1-30'] },
        { date: '2026-10-31', sourceRows: ['徒7', '徒8'], references: ['ACT.7.31-60', 'ACT.8'] },
        { date: '2026-11-02', sourceRows: ['徒9'], references: ['ACT.9'] },
      ],
      dates: ['2026-10-30', '2026-10-31', '2026-11-02'],
      uniqueReferences: ['ACT.7.1-30', 'ACT.7.31-60', 'ACT.8', 'ACT.9'],
    });
    setSelectedReadingDate('2026-10-31');
    expect(getReadingSessionSnapshot()).toMatchObject({ previousDate: '2026-10-30', nextDate: '2026-11-02', adjacentReferences: ['ACT.7.1-30', 'ACT.9'] });
    setSelectedReadingDate('2026-11-02');
    expect(getReadingSessionSnapshot().adjacentReferences).toEqual(['ACT.7.31-60', 'ACT.8']);
  });
});
