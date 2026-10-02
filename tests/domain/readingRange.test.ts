import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readerSegments, readingRangeOf } from '../../src/domain/readingRange';
import { formatReferenceZhTw } from '../../src/domain/scriptureReference';

// Half-chapter days (maintainer 2026-10-01/02): the reader shows the whole chapter but knows the range.
describe('the verse range of a plan reference', () => {
  it('reads the chapter and the verses of a half chapter', () => {
    expect(readingRangeOf('PSA.119.1-88')).toEqual({ chapterUsfm: 'PSA.119', first: 1, last: 88 });
    expect(readingRangeOf('ACT.2.25-47')).toEqual({ chapterUsfm: 'ACT.2', first: 25, last: 47 });
    expect(readingRangeOf('JHN.3.16')).toEqual({ chapterUsfm: 'JHN.3', first: 16, last: 16 });
  });

  it('has no range for a whole chapter or anything it cannot read', () => {
    for (const reference of ['ACT.1', 'PSA.119', '', 'ACT.2.24-1', 'ACT.2.0-3', 'ACT.2.x', 'ACT']) {
      expect(readingRangeOf(reference)).toBeNull();
    }
  });
});

describe('the reader\'s segments for a day', () => {
  it('joins two halves of one chapter that follow each other into the chapter, so it is read and narrated once', () => {
    // 10/23: 溫故 徒2:1-24 and 知新 徒2:25-47 are one tag 徒2.
    expect(readerSegments(['ACT.2.1-24', 'ACT.2.25-47'])).toEqual(['ACT.2']);
    expect(readerSegments(['ACT.2.1-24', 'ACT.2.25-47']).map(formatReferenceZhTw)).toEqual(['徒2']);
  });

  it('keeps every other day as the plan writes it', () => {
    expect(readerSegments(['PSA.119.1-88'])).toEqual(['PSA.119.1-88']);
    expect(readerSegments(['ACT.1', 'ACT.2.1-24'])).toEqual(['ACT.1', 'ACT.2.1-24']);
    expect(readerSegments(['ACT.2.25-47', 'ACT.3'])).toEqual(['ACT.2.25-47', 'ACT.3']);
    // Not adjacent verses (7:30 is not in the plan), so not one passage.
    expect(readerSegments(['ACT.7.1-29', 'ACT.7.31-60'])).toEqual(['ACT.7.1-29', 'ACT.7.31-60']);
    // Not adjacent in the day's order.
    expect(readerSegments(['ACT.2.1-24', 'PSA.1', 'ACT.2.25-47'])).toEqual(['ACT.2.1-24', 'PSA.1', 'ACT.2.25-47']);
    // Two adjacent pieces that do not start the chapter stay a range.
    expect(readerSegments(['PSA.119.89-120', 'PSA.119.121-176'])).toEqual(['PSA.119.89-176']);
    expect(readerSegments([])).toEqual([]);
  });

  // The joined passage is shown and narrated as the whole chapter. That holds because the church's
  // sheet only ever splits a chapter into a first and a second half; this pins it for the 2026 plan.
  it('joins, in the 2026 plan, only halves that make up their whole chapter', () => {
    const LAST_VERSE: Record<string, number> = { 'ACT.2': 47, 'ACT.7': 60, 'ACT.10': 48, 'ACT.13': 52, 'PSA.119': 176, 'JHN.12': 50 };
    const plan = JSON.parse(readFileSync('data/reading-plan-2026.json', 'utf8')) as { days: Array<{ date: string; references: string[] }> };
    const joined: string[] = [];
    for (const day of plan.days) {
      const segments = readerSegments(day.references);
      if (segments.length === day.references.length) continue;
      joined.push(day.date);
      for (const segment of segments.filter(s => !day.references.includes(s))) {
        const pieces = day.references.filter(r => readingRangeOf(r)?.chapterUsfm === segment);
        expect(readingRangeOf(pieces[0])?.first, `${day.date} starts the chapter`).toBe(1);
        expect(readingRangeOf(pieces[pieces.length - 1])?.last, `${day.date} ends the chapter`).toBe(LAST_VERSE[segment]);
      }
    }
    expect(joined).toEqual(['2026-10-23', '2026-11-04', '2026-11-09']);
  });
});
