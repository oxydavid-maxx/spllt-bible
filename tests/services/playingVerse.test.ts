import { describe, expect, it } from 'vitest';
import { resolveChapterAudioSession, verseAtPosition } from '../../src/services/audioChapterResolver';

const timing = [{ verse: 1, start: 2.9, end: 9.5 }, { verse: 2, start: 9.5, end: 14 }, { verse: 3, start: 14, end: 20.4 }];
const capability = {
  identity: { versionId: 46, usfm: 'PSA.95' }, text: true, audio: true, offline: false as const, status: 'verified_source' as const, reason: '',
  uri: 'https://example.test/psa95.mp3', providerExpiry: null, validUntil: new Date('2030-01-01T00:00:00Z').toISOString(),
  provenance: { publisher: 'P', edition: 'E', recordingId: '1310', reference: '詩篇 95', attribution: 'A' },
};

describe('verseAtPosition', () => {
  it('returns null before the first verse and without timing', () => {
    expect(verseAtPosition(timing, 0)).toBeNull();
    expect(verseAtPosition(timing, 2.89)).toBeNull();
    expect(verseAtPosition(undefined, 10)).toBeNull();
    expect(verseAtPosition([], 10)).toBeNull();
    expect(verseAtPosition(timing, Number.NaN)).toBeNull();
  });
  it('picks the last verse whose start has been reached, including exactly on a boundary and after the last end', () => {
    expect(verseAtPosition(timing, 2.9)).toBe(1);
    expect(verseAtPosition(timing, 9.0)).toBe(1);
    expect(verseAtPosition(timing, 9.5)).toBe(2);
    expect(verseAtPosition(timing, 10.0)).toBe(2);
    expect(verseAtPosition(timing, 14.0)).toBe(3);
    expect(verseAtPosition(timing, 99)).toBe(3);
  });
});

describe('resolveChapterAudioSession carries verse timing', () => {
  it('passes the capability timing into the playable source and omits it when absent', () => {
    const withTiming = resolveChapterAudioSession({ chapterUsfm: 'PSA.95', versionId: 46, qaTestAudioEnabled: false, audioAuthorized: true, capability: { ...capability, verseTiming: timing } });
    expect(withTiming.availability.status).toBe('READY');
    expect(withTiming.source?.verseTiming).toEqual(timing);
    const without = resolveChapterAudioSession({ chapterUsfm: 'PSA.95', versionId: 46, qaTestAudioEnabled: false, audioAuthorized: true, capability });
    expect(without.availability.status).toBe('READY');
    expect(without.source).not.toHaveProperty('verseTiming');
  });
});
