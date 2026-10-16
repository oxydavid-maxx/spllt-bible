import { describe, expect, it } from 'vitest';
import { parseAssignedVerseRange, verseOverlapsRange } from '../../src/domain/partialChapter';

describe('assigned verse ranges', () => {
  it.each([
    ['PSA.119.89-176', 'PSA.119', 89, 176, '詩篇 119:89–176'],
    ['PSA.119.1-88', 'PSA.119', 1, 88, '詩篇 119:1–88'],
    ['ACT.7.1-29', 'ACT.7', 1, 29, '使徒行傳 7:1–29'],
    [' jhn.3.16 ', 'JHN.3', 16, 16, '約翰福音 3:16'],
  ])('parses %s without changing its chapter identity', (ref, chapterUsfm, firstVerse, lastVerse, label) => {
    expect(parseAssignedVerseRange(ref)).toEqual({ chapterUsfm, firstVerse, lastVerse, label });
  });
  it.each(['PSA.119', 'PSA.118-119', '', 'PSA.119.0-3', 'PSA.119.9-2', 'PSA.119.1-x', 'PSA.0.1-2'])('leaves whole chapters and invalid references unrestricted: %s', ref => {
    expect(parseAssignedVerseRange(ref)).toBeNull();
  });
  it('keeps an indivisible 5-6 unit if either verse is assigned, including a range boundary', () => {
    expect(verseOverlapsRange('5-6', { firstVerse: 6, lastVerse: 9 })).toBe(true);
    expect(verseOverlapsRange('5-6', { firstVerse: 1, lastVerse: 5 })).toBe(true);
    expect(verseOverlapsRange('5-6', { firstVerse: 7, lastVerse: 9 })).toBe(false);
    expect(verseOverlapsRange('bogus', { firstVerse: 1, lastVerse: 9 })).toBe(false);
  });
});
