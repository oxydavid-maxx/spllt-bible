import { describe, expect, it } from 'vitest';
import {
  createChapterAudioRegistry,
  lookupChapterAudio,
  OBSERVED_ROWS,
  rowValidUntil,
  type RegistryRow,
} from '../../server/contentRegistry';
import { evaluateContentCapability, parseCapabilityQuery } from '../../server/contentCapabilities';
import { validateCapability } from '../../src/domain/chapterAudioContract';

// Review 119 R3/R5/R6/R7. R6 specifically: the positive path is proven against KNOWN INJECTED rows
// instead of being left as a todo, and the expiry boundary is proven with a controlled clock rather
// than by waiting or by needing a device.

const prov = {
  publisher: 'Test Publisher',
  edition: 'Test Edition',
  recordingId: '4242',
  reference: '',
  attribution: 'Test attribution',
};

const row = (over: Partial<RegistryRow> = {}): RegistryRow => ({
  versionId: 1392,
  usfm: 'JHN.13',
  audioUrl: 'https://cdn.example/jhn13.mp3',
  sourcePageUrl: 'https://example/page',
  observedAtUtc: '2026-09-11T00:00:00Z',
  providerExpiry: null,
  evidenceDigest: 'test',
  resolutionStatus: 'verified_source',
  provenance: prov,
  ...over,
});

const NOW = Date.parse('2026-09-12T00:00:00Z');

describe('registry lookup never substitutes another chapter (R7)', () => {
  const reg = createChapterAudioRegistry([row(), row({ usfm: 'PSA.90', audioUrl: 'https://cdn.example/psa90.mp3' })]);

  it('returns the row for the exact pair', () => {
    expect(reg.lookup(1392, 'JHN.13')?.audioUrl).toBe('https://cdn.example/jhn13.mp3');
    expect(reg.lookup(1392, 'PSA.90')?.audioUrl).toBe('https://cdn.example/psa90.mp3');
  });

  it('returns null for an unknown chapter instead of the first or nearest row', () => {
    expect(reg.lookup(1392, 'TIT.1')).toBeNull();
  });

  it('does not serve one version\'s row for another version', () => {
    expect(reg.lookup(312, 'JHN.13')).toBeNull();
  });
});

describe('the shipped registry is a general mechanism, not a whitelist (R7)', () => {
  it('holds the 20 observed September chapters plus GEN.1', () => {
    expect(OBSERVED_ROWS.length).toBe(22);
  });

  it('serves GEN.1, which is NOT one of the September 42 — so there is no 42-chapter whitelist', () => {
    const gen = lookupChapterAudio(1392, 'GEN.1');
    expect(gen).not.toBeNull();
    expect(gen?.audioUrl).toContain('/GEN/1-');
  });

  it('leaves the uncollected chapters ABSENT, which means "address not obtained"', () => {
    // these chapters were never collected; absent must never be read as "this chapter has no recording"
    for (const usfm of ['TIT.1', 'PHM.1', '2TI.4', 'PSA.106']) {
      expect(lookupChapterAudio(1392, usfm)).toBeNull();
      expect(evaluateContentCapability(1392, usfm, { nowMs: NOW }).status).toBe('pending_observation');
    }
  });

  it('never reports a chapter we simply did not collect as explicit_no_audio', () => {
    expect(evaluateContentCapability(1392, 'TIT.1', { nowMs: NOW }).status).not.toBe('explicit_no_audio');
  });
});

describe('capability enforces expiry rather than passing it through (R3)', () => {
  it('serves a fresh row', () => {
    const reg = createChapterAudioRegistry([row()]);
    const cap = evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW });
    expect(cap.audio).toBe(true);
    expect(cap.uri).toBe('https://cdn.example/jhn13.mp3');
  });

  it('refuses a row whose PROVIDER expiry has passed, and does not return its uri', () => {
    const reg = createChapterAudioRegistry([row({ providerExpiry: '2026-09-11T12:00:00Z' })]);
    const cap = evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW });
    expect(cap.audio).toBe(false);
    expect(cap.uri).toBeUndefined();
    expect(cap.status).toBe('temporarily_unavailable');
  });

  it('refuses a row past OUR refresh policy even though the provider stated no expiry', () => {
    const reg = createChapterAudioRegistry([row({ observedAtUtc: '2026-01-01T00:00:00Z' })]);
    const cap = evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW });
    expect(cap.audio).toBe(false);
    expect(cap.status).toBe('temporarily_unavailable');
  });

  it('holds the policy boundary exactly: valid just before, refused just after', () => {
    const reg = createChapterAudioRegistry([row({ observedAtUtc: '2026-09-11T00:00:00Z' })]);
    const boundary = Date.parse(rowValidUntil(row({ observedAtUtc: '2026-09-11T00:00:00Z' }))!);
    expect(evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: boundary - 1000 }).audio).toBe(true);
    expect(evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: boundary + 1000 }).audio).toBe(false);
  });

  it('treats a malformed provider expiry as unavailable, not as unknown-and-therefore-fine', () => {
    const reg = createChapterAudioRegistry([row({ providerExpiry: 'whenever' })]);
    expect(evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW }).audio).toBe(false);
  });

  it('reports the provider expiry as null (unknown) without inventing one', () => {
    const reg = createChapterAudioRegistry([row()]);
    expect(evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW }).providerExpiry).toBeNull();
  });
});

describe('capability carries per-row provenance and identity (R2/R5)', () => {
  it('answers with the identity it was asked about', () => {
    const reg = createChapterAudioRegistry([row()]);
    const cap = evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW });
    expect(cap.identity).toEqual({ versionId: 1392, usfm: 'JHN.13' });
  });

  it('keeps a non-CCB edition\'s own publisher instead of defaulting to Biblica', () => {
    const reg = createChapterAudioRegistry([row({ provenance: { ...prov, publisher: 'Another Publisher' } })]);
    const cap = evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW });
    expect(cap.provenance?.publisher).toBe('Another Publisher');
  });

  it('fills the display reference from the project formatter rather than a second mapping', () => {
    const reg = createChapterAudioRegistry([row()]);
    expect(evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW }).provenance?.reference).toBe('約13');
  });

  it('does not claim text:true for a pair we hold no row for', () => {
    const reg = createChapterAudioRegistry([row()]);
    expect(evaluateContentCapability(1392, 'REV.1', { registry: reg, nowMs: NOW }).text).toBe(false);
  });

  it('produces payloads the CLIENT validator accepts end to end', () => {
    const reg = createChapterAudioRegistry([row()]);
    const cap = evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW });
    const check = validateCapability(cap, { versionId: 1392, usfm: 'JHN.13' }, NOW);
    expect(check.ok).toBe(true);
  });

  it('produces an EXPIRED payload the client also refuses, so neither side can be bypassed', () => {
    const reg = createChapterAudioRegistry([row({ providerExpiry: '2026-09-11T00:00:00Z' })]);
    const cap = evaluateContentCapability(1392, 'JHN.13', { registry: reg, nowMs: NOW });
    expect(validateCapability(cap, { versionId: 1392, usfm: 'JHN.13' }, NOW).ok).toBe(false);
  });
});

describe('query parsing', () => {
  it('accepts a well-formed query and upper-cases the usfm', () => {
    expect(parseCapabilityQuery({ versionId: '1392', usfm: 'psa.90' })).toEqual({ ok: true, versionId: 1392, usfm: 'PSA.90' });
  });

  it('rejects a missing or non-integer version and a malformed usfm', () => {
    expect(parseCapabilityQuery({ usfm: 'PSA.90' }).ok).toBe(false);
    expect(parseCapabilityQuery({ versionId: 'abc', usfm: 'PSA.90' }).ok).toBe(false);
    expect(parseCapabilityQuery({ versionId: '1392', usfm: 'not a reference' }).ok).toBe(false);
  });
});
