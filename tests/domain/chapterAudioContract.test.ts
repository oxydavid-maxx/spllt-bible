import { describe, expect, it } from 'vitest';
import {
  isRetryable,
  statusMessage,
  validateCapability,
  type ChapterAudioIdentity,
} from '../../src/domain/chapterAudioContract';

// Review 119 R2/R3/R5. Every case here fails against the ORIGINAL plan, which checked only
// `audio === true` and a non-empty uri, then pasted the result onto whatever chapter was on screen.

const NOW = Date.parse('2026-09-12T00:00:00Z');
const want: ChapterAudioIdentity = { versionId: 1392, usfm: 'PSA.90' };

const prov = {
  publisher: 'Biblica',
  edition: '當代譯本(繁體)',
  recordingId: '1320',
  reference: '詩90',
  attribution: 'CCB Audio ℗ 2011 Biblica',
};

const good = (over: Record<string, unknown> = {}) => ({
  identity: { versionId: 1392, usfm: 'PSA.90' },
  text: true,
  audio: true,
  offline: false,
  status: 'verified_source',
  reason: '',
  uri: 'https://cdn.example/psa90.mp3',
  providerExpiry: null,
  validUntil: '2026-10-11T00:00:00Z',
  provenance: prov,
  ...over,
});

describe('validateCapability — identity (R2)', () => {
  it('accepts a capability that answers for exactly what was requested', () => {
    const r = validateCapability(good(), want, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.capability.uri).toBe('https://cdn.example/psa90.mp3');
  });

  it('REFUSES another chapter even when audio=true and a uri is present', () => {
    // this is the exact defect: a late JHN.13 answer landing on PSA.90
    const r = validateCapability(good({ identity: { versionId: 1392, usfm: 'JHN.13' } }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('IDENTITY_MISMATCH');
  });

  it('REFUSES a different version for the same chapter', () => {
    const r = validateCapability(good({ identity: { versionId: 312, usfm: 'PSA.90' } }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('IDENTITY_MISMATCH');
  });

  it('REFUSES a payload with no identity at all rather than assuming it is the current chapter', () => {
    const r = validateCapability(good({ identity: undefined }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('IDENTITY_MISMATCH');
  });

  it('matches usfm case-insensitively, because a case difference is not a different chapter', () => {
    expect(validateCapability(good({ identity: { versionId: 1392, usfm: 'psa.90' } }), want, NOW).ok).toBe(true);
  });
});

describe('validateCapability — expiry (R3)', () => {
  it('refuses a capability whose PROVIDER expiry has passed', () => {
    const r = validateCapability(good({ providerExpiry: '2026-09-11T00:00:00Z' }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('EXPIRED');
  });

  it('refuses a capability past OUR validUntil even when the provider states no expiry', () => {
    const r = validateCapability(good({ providerExpiry: null, validUntil: '2026-09-11T23:59:59Z' }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('EXPIRED');
  });

  it('accepts one second BEFORE the boundary and refuses one second after', () => {
    const before = validateCapability(good({ validUntil: '2026-09-12T00:00:01Z' }), want, NOW);
    const after = validateCapability(good({ validUntil: '2026-09-11T23:59:59Z' }), want, NOW);
    expect(before.ok).toBe(true);
    expect(after.ok).toBe(false);
  });

  it('treats a MALFORMED expiry as an error, never as "unknown, therefore fine"', () => {
    const r = validateCapability(good({ providerExpiry: 'not-a-date' }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('MALFORMED_EXPIRY');
  });

  it('keeps a null provider expiry as UNKNOWN and does not turn it into a permanence guarantee', () => {
    const r = validateCapability(good({ providerExpiry: null }), want, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.capability.providerExpiry).toBeNull();
  });
});

describe('validateCapability — shape and provenance (R5)', () => {
  it('refuses an unknown status string even if everything else looks right', () => {
    const r = validateCapability(good({ status: 'probably_fine' }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('BAD_STATUS');
  });

  it('refuses audio=true with a missing uri', () => {
    const r = validateCapability(good({ uri: undefined }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('AUDIO_WITHOUT_URI');
  });

  it('refuses a playable claim with no provenance rather than defaulting to another edition', () => {
    const r = validateCapability(good({ provenance: undefined }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('MISSING_PROVENANCE');
  });

  it('keeps a DIFFERENT edition\'s own provenance instead of falling back to CCB/Biblica', () => {
    const other = { publisher: 'Other Publisher', edition: 'Another Edition', recordingId: '9999', reference: '詩90', attribution: 'X' };
    const r = validateCapability(good({ provenance: other }), want, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.capability.provenance.publisher).toBe('Other Publisher');
      expect(r.capability.provenance.recordingId).toBe('9999');
    }
  });

  it('hands back a well-formed explicit_no_audio so the surface can state it honestly', () => {
    const r = validateCapability(good({ audio: false, status: 'explicit_no_audio', uri: undefined }), want, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.capability?.status).toBe('explicit_no_audio');
  });

  it('refuses a non-object payload', () => {
    expect(validateCapability(null, want, NOW).ok).toBe(false);
    expect(validateCapability('nope', want, NOW).ok).toBe(false);
  });
});

describe('status messages stay distinct and retryable-ness is honest', () => {
  it('never collapses temporary failure into "no recording exists"', () => {
    expect(statusMessage('temporarily_unavailable')).not.toBe(statusMessage('explicit_no_audio'));
  });

  it('offers retry for temporary and pending, but not for a stated absence', () => {
    expect(isRetryable('temporarily_unavailable')).toBe(true);
    expect(isRetryable('pending_observation')).toBe(true);
    expect(isRetryable('explicit_no_audio')).toBe(false);
  });

  it('carries no internal approval terminology on any product-facing string', () => {
    const all = (['verified_source', 'pending_observation', 'temporarily_unavailable', 'explicit_no_audio'] as const)
      .map(statusMessage)
      .join(' ');
    for (const banned of ['使用者授權', '授權音源', '開發者遞送授權']) {
      expect(all).not.toContain(banned);
    }
  });
});
