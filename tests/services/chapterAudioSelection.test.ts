import { describe, expect, it } from 'vitest';
import { chapterAudioRenderMode, resolveChapterAudioSession, type PlayableCapability } from '../../src/services/audioChapterResolver';

// Review 119 R1/R2/R5. The shipped resolver refused every chapter except JHN.13 against version 1392.
// These tests prove the selected chapter is what plays, and that removing that cap did NOT remove the
// identity protection with it.

const prov = (reference: string) => ({
  publisher: 'Biblica',
  edition: '當代譯本(繁體)',
  recordingId: '1320',
  reference,
  attribution: 'CCB Audio ℗ 2011 Biblica',
});

const cap = (usfm: string, uri: string, reference: string, versionId = 1392): PlayableCapability => ({
  identity: { versionId, usfm },
  text: true,
  audio: true,
  offline: false,
  status: 'verified_source',
  reason: '',
  uri,
  providerExpiry: null,
  validUntil: '2026-10-11T00:00:00Z',
  provenance: prov(reference),
});

const resolve = (usfm: string, capability: PlayableCapability | null, versionId: number | null = 1392) =>
  resolveChapterAudioSession({ chapterUsfm: usfm, versionId, qaTestAudioEnabled: false, audioAuthorized: true, capability });

describe('the chapter the reader selected is the chapter that plays (R1)', () => {
  it('serves a September chapter that is NOT JHN.13', () => {
    const s = resolve('PSA.90', cap('PSA.90', 'https://cdn.example/psa90.mp3', '詩90'));
    expect(s.source?.chapterUsfm).toBe('PSA.90');
    expect(s.source?.uri).toBe('https://cdn.example/psa90.mp3');
    expect(chapterAudioRenderMode(s)).toBe('PLAYER');
  });

  it('serves GEN.1, which is outside the September 42, through the SAME path — no whitelist branch', () => {
    const s = resolve('GEN.1', cap('GEN.1', 'https://cdn.example/gen1.mp3', '創1'));
    expect(s.source?.chapterUsfm).toBe('GEN.1');
    expect(s.sourceClass).toBe('authorized-source');
  });

  it('labels the source with the chapter that was asked for, not a fixed label', () => {
    expect(resolve('1TI.3', cap('1TI.3', 'https://cdn.example/1ti3.mp3', '提前3')).source?.chapterLabel).toBe('提前3');
  });

  it('still serves JHN.13, so lifting the cap did not regress the one chapter that already worked', () => {
    expect(resolve('JHN.13', cap('JHN.13', 'https://cdn.example/jhn13.mp3', '約13')).source?.uri)
      .toBe('https://cdn.example/jhn13.mp3');
  });
});

describe('no source is ever substituted for a chapter that has none (R1)', () => {
  it('returns NO source when no capability resolved, and draws nothing', () => {
    const s = resolve('PSA.119', null);
    expect(s.source).toBeNull();
    expect(chapterAudioRenderMode(s)).toBe('NONE');
  });

  it('does not fall back to a build-supplied URI for an unresolved chapter', () => {
    // the exact defect the earlier draft would have shipped: `?? AUTHORIZED_AUDIO_URI`
    const s = resolveChapterAudioSession({
      chapterUsfm: 'PSA.119',
      versionId: 1392,
      qaTestAudioEnabled: false,
      audioAuthorized: true,
      authorizedAudioUri: 'https://cdn.example/jhn13.mp3',
      capability: null,
    });
    expect(s.source).toBeNull();
  });

  it('refuses a capability that answers for a DIFFERENT chapter, even though it is playable (R2)', () => {
    const s = resolve('PSA.90', cap('JHN.13', 'https://cdn.example/jhn13.mp3', '約13'));
    expect(s.source).toBeNull();
  });

  it('refuses a capability for a different VERSION of the same chapter (R2)', () => {
    const s = resolve('PSA.90', cap('PSA.90', 'https://cdn.example/psa90.mp3', '詩90', 312));
    expect(s.source).toBeNull();
  });
});

describe('what the reader is told (R5)', () => {
  it('carries publisher and edition from the capability row', () => {
    const s = resolve('PSA.90', cap('PSA.90', 'https://cdn.example/psa90.mp3', '詩90'));
    expect(s.source?.publisher).toBe('Biblica');
    expect(s.source?.recordingEdition).toBe('當代譯本(繁體)');
  });

  it('keeps a different edition\'s provenance instead of forcing CCB onto it', () => {
    const other: PlayableCapability = {
      ...cap('PSA.90', 'https://cdn.example/other.mp3', '詩90'),
      provenance: { publisher: 'Another Publisher', edition: 'Another Edition', recordingId: '7777', reference: '詩90', attribution: 'Other attribution' },
    };
    const s = resolve('PSA.90', other);
    expect(s.source?.publisher).toBe('Another Publisher');
    expect(s.source?.recordingEdition).toBe('Another Edition');
    expect(s.availability.recordingId).toBe('7777');
  });

  it('exposes NO internal approval terminology anywhere in the resolved session', () => {
    const s = resolve('PSA.90', cap('PSA.90', 'https://cdn.example/psa90.mp3', '詩90'));
    const text = [s.availability.reason, s.source?.recordingEdition, s.source?.attribution, s.source?.chapterLabel].join(' ');
    for (const banned of ['使用者授權', '授權音源', '開發者遞送授權']) {
      expect(text).not.toContain(banned);
    }
  });
});
