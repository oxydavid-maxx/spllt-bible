import { describe, expect, it } from 'vitest';
import { verseTimingOf } from '../../server/genericChapterAudio';

// The narrated verse drives the reading highlight. A chapter whose text merges verses (詩105:5-6 is
// one unit in both 和合本 and 當代譯本) comes with a timing row per merged unit in some recordings:
// 當代譯本 (1392) writes it as PSA.105.5+PSA.105.6, and dropping that row left the highlight on
// verse 4 while 5-6 was read (2026-09-29).
describe('verse timing of one recording', () => {
  const row = (usfm: string, start: number, end: number) => ({ usfm, start, end });

  it('reads a merged row as its first verse, with the row\'s own times', () => {
    const timing = verseTimingOf([
      row('PSA.105.4', 26, 30.78),
      row('PSA.105.5+PSA.105.6', 31.82, 41.32),
      row('PSA.105.7', 42.4, 47.42),
    ], 'PSA.105');
    expect(timing).toEqual([
      { verse: 4, start: 26, end: 30.78 },
      { verse: 5, start: 31.82, end: 41.32 },
      { verse: 7, start: 42.4, end: 47.42 },
    ]);
  });

  it('reads a range row the same way', () => {
    expect(verseTimingOf([row('PSA.105.5-6', 31.82, 41.32)], 'PSA.105')).toEqual([{ verse: 5, start: 31.82, end: 41.32 }]);
  });

  it('still drops rows that are not one contiguous span of this chapter', () => {
    expect(verseTimingOf([
      row('PSA.105.5+PSA.105.7', 1, 2),
      row('PSA.105.5+PSA.106.1', 3, 4),
      row('PSA.105.6-5', 5, 6),
      row('PSA.106.1', 7, 8),
    ], 'PSA.105')).toEqual([]);
  });

  it('keeps the plain per-verse rows as they are (和合本 gives 5 a near-zero span and 6 the reading)', () => {
    expect(verseTimingOf([
      row('PSA.105.5', 29.150625, 29.15770833),
      row('PSA.105.6', 29.15770833, 41.89402083),
    ], 'PSA.105')).toEqual([
      { verse: 5, start: 29.150625, end: 29.15770833 },
      { verse: 6, start: 29.15770833, end: 41.89402083 },
    ]);
  });
});
