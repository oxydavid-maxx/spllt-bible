import { describe, expect, it } from 'vitest';
import { validateCapability, type ChapterAudioIdentity } from '../../src/domain/chapterAudioContract';
import { fetchChapterCapability } from '../../src/services/contentCapabilityClient';

// Review 121 C1-C3. Every case here PASSED against the shipped code and must not.

const want: ChapterAudioIdentity = { versionId: 1392, usfm: 'PSA.90' };
const T0 = Date.parse('2026-09-12T00:00:00Z');

const prov = {
  publisher: 'Biblica',
  edition: '當代譯本(繁體)',
  recordingId: '1320',
  reference: '詩90',
  attribution: 'CCB Audio ℗ 2011 Biblica',
};

const payload = (over: Record<string, unknown> = {}) => ({
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

describe('C1 — expiry is judged when the response ARRIVES, not when it was requested', () => {
  it('refuses a capability that expired while the request was in flight', async () => {
    // request at t0, validUntil at t0+1s, response released at t0+2s: expired by arrival
    let clockMs = T0;
    const impl = (async () => {
      clockMs = T0 + 2000; // time passes during the round trip
      return { ok: true, status: 200, json: async () => payload({ validUntil: new Date(T0 + 1000).toISOString() }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: want, now: () => clockMs, fetchImpl: impl,
    });
    expect(out.kind).toBe('unavailable');
    if (out.kind === 'unavailable') expect(out.diagnostic).toContain('EXPIRED');
  });

  it('still accepts one that is valid at arrival, so the moving clock is not a blanket refusal', async () => {
    let clockMs = T0;
    const impl = (async () => {
      clockMs = T0 + 2000;
      return { ok: true, status: 200, json: async () => payload({ validUntil: new Date(T0 + 60_000).toISOString() }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: want, now: () => clockMs, fetchImpl: impl,
    });
    expect(out.kind).toBe('playable');
  });

  it('keeps deterministic injection: a frozen clock behaves exactly as before', async () => {
    const impl = (async () => ({ ok: true, status: 200, json: async () => payload() }) as unknown as Response) as unknown as typeof fetch;
    const out = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: want, now: () => T0, fetchImpl: impl,
    });
    expect(out.kind).toBe('playable');
  });
});

describe('C2 — an unknown provider expiry still needs OUR refresh boundary', () => {
  it('refuses when the provider states nothing AND we have no validUntil', () => {
    const r = validateCapability(payload({ providerExpiry: null, validUntil: null }), want, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('MALFORMED_EXPIRY');
  });

  it('refuses when validUntil is simply absent', () => {
    const raw = payload({ providerExpiry: null }) as Record<string, unknown>;
    delete raw.validUntil;
    expect(validateCapability(raw, want, T0).ok).toBe(false);
  });

  it('refuses when validUntil is already in the past', () => {
    expect(validateCapability(payload({ providerExpiry: null, validUntil: '2026-09-11T00:00:00Z' }), want, T0).ok).toBe(false);
  });

  it('accepts an unknown provider expiry WITH a future refresh boundary, and keeps the unknown honest', () => {
    const r = validateCapability(payload({ providerExpiry: null, validUntil: '2026-10-11T00:00:00Z' }), want, T0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.capability.providerExpiry).toBeNull();
  });

  it('does not demand validUntil when the provider DID state a future expiry', () => {
    const raw = payload({ providerExpiry: '2026-12-01T00:00:00Z' }) as Record<string, unknown>;
    delete raw.validUntil;
    expect(validateCapability(raw, want, T0).ok).toBe(true);
  });
});

describe('C3 — the stream address must be an approved https stream', () => {
  it('refuses a local file scheme', () => {
    const r = validateCapability(payload({ uri: 'file:///sdcard/psa90.mp3' }), want, T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('URI_NOT_ALLOWED');
  });

  it('refuses plain text that is not a URL at all', () => {
    expect(validateCapability(payload({ uri: 'not a url' }), want, T0).ok).toBe(false);
  });

  it('refuses cleartext http, which would be an unprotected stream', () => {
    expect(validateCapability(payload({ uri: 'http://cdn.example/psa90.mp3' }), want, T0).ok).toBe(false);
  });

  it('refuses other schemes that are not streaming at all', () => {
    for (const uri of ['javascript:alert(1)', 'data:audio/mp3;base64,AAAA', 'content://media/1', 'ftp://x/y.mp3']) {
      expect(validateCapability(payload({ uri }), want, T0).ok).toBe(false);
    }
  });

  it('accepts the legitimate authorized https stream', () => {
    const r = validateCapability(payload({ uri: 'https://audio-bible-cdn.youversionapi.com/1320/32k/PSA/90-abc.mp3?version_id=1392' }), want, T0);
    expect(r.ok).toBe(true);
  });
});
