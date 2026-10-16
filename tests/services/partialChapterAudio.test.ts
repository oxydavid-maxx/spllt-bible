import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAssignedVerseRange } from '../../src/domain/partialChapter';
import { resolvePassageAudioWindow } from '../../src/services/partialChapterAudio';

const recorded = JSON.parse(readFileSync('tests/fixtures/partial-chapter-audio.json', 'utf8'));
describe('recording-specific partial chapter audio boundaries', () => {
  it.each([
    [46, 'PSA.119.1-88', 3.44589583, 524.56158333],
    [46, 'PSA.119.89-176', 524.56158333, 1067.256],
    [40, 'PSA.119.1-88', 3.26, 489.5],
    [40, 'PSA.119.89-176', 489.5, 1002.08],
  ])('uses version %s timing for %s', (versionId, reference, start, end) => {
    const timing = recorded.cases.find((row: any) => row.versionId === versionId && row.usfm === 'PSA.119').verseTiming;
    expect(resolvePassageAudioWindow(parseAssignedVerseRange(reference), timing)).toEqual({ kind: 'range', start, end });
  });
  it('does not seek or stop a whole-chapter reference', () => {
    expect(resolvePassageAudioWindow(null, recorded.cases[0].verseTiming)).toEqual({ kind: 'chapter' });
  });
  it.each([undefined, [], [{ verse: 89, start: 100, end: 105 }], [{ verse: 88, start: -1, end: 100 }, { verse: 89, start: 100, end: 105 }]])('falls back to the whole recording when either boundary is unavailable', timing => {
    expect(resolvePassageAudioWindow(parseAssignedVerseRange('PSA.119.88-89'), timing)).toEqual({ kind: 'unsegmented' });
  });
  it('uses the last assigned verse end, not the next verse start or a different chapter timing', () => {
    expect(resolvePassageAudioWindow(parseAssignedVerseRange('ACT.7.1-2'), [
      { verse: 1, start: 3, end: 8 }, { verse: 2, start: 8, end: 14 }, { verse: 3, start: 17, end: 20 },
    ])).toEqual({ kind: 'range', start: 3, end: 14 });
  });
});
