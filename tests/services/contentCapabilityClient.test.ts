import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capabilityUrl,
  createCapabilityCoordinator,
  fetchChapterCapability,
} from '../../src/services/contentCapabilityClient';

// Review 119 R2. These are the cases the original plan's client could not pass: it had no generation,
// no abort and no identity check, so a slow earlier response could overwrite the current chapter.

const NOW = Date.parse('2026-09-12T00:00:00Z');
afterEach(() => vi.useRealTimers());
const prov = {
  publisher: 'Biblica',
  edition: '當代譯本(繁體)',
  recordingId: '1320',
  reference: '詩90',
  attribution: 'CCB Audio ℗ 2011 Biblica',
};

const payload = (usfm: string, uri: string) => ({
  identity: { versionId: 1392, usfm },
  text: true,
  audio: true,
  offline: false,
  status: 'verified_source',
  reason: '',
  uri,
  providerExpiry: null,
  validUntil: '2026-10-11T00:00:00Z',
  provenance: { ...prov, reference: usfm },
});

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

/** A fetch whose responses are released by hand, so ordering can be controlled exactly. */
function deferredFetch() {
  const pending = new Map<string, (r: Response) => void>();
  const impl = ((url: string) => new Promise<Response>((resolve) => {
    const usfm = new URL(url).searchParams.get('usfm') ?? '';
    pending.set(usfm, resolve);
  })) as unknown as typeof fetch;
  return {
    impl,
    release(usfm: string, body: unknown) {
      const r = pending.get(usfm);
      if (!r) throw new Error(`nothing pending for ${usfm}`);
      pending.delete(usfm);
      r(jsonResponse(body));
    },
    waitingFor: () => [...pending.keys()],
  };
}

describe('capabilityUrl', () => {
  it('asks about exactly one chapter and tolerates a trailing slash on the base', () => {
    const u = capabilityUrl('https://api.example/', { versionId: 1392, usfm: 'PSA.90' });
    expect(u).toBe('https://api.example/api/content-capabilities?versionId=1392&usfm=PSA.90');
  });
});

describe('coordinator: a late answer never lands on the current chapter (R2)', () => {
  it('keeps B when A is requested first, B second, B returns first and A returns LAST', async () => {
    const f = deferredFetch();
    const coord = createCapabilityCoordinator({ baseUrl: 'https://api.example', fetchImpl: f.impl });

    const aPromise = coord.request({ versionId: 1392, usfm: 'JHN.13' }, () => NOW);
    const bPromise = coord.request({ versionId: 1392, usfm: 'PSA.90' }, () => NOW);

    f.release('PSA.90', payload('PSA.90', 'https://cdn.example/psa90.mp3'));
    const b = await bPromise;
    expect(b.kind).toBe('playable');
    if (b.kind === 'playable') expect(b.capability.uri).toBe('https://cdn.example/psa90.mp3');

    // A now answers, AFTER B was already applied. It must be discarded.
    f.release('JHN.13', payload('JHN.13', 'https://cdn.example/jhn13.mp3'));
    const a = await aPromise;
    expect(a.kind).toBe('stale');
  });

  it('discards a late answer for a chapter the reader has already left (cancel)', async () => {
    const f = deferredFetch();
    const coord = createCapabilityCoordinator({ baseUrl: 'https://api.example', fetchImpl: f.impl });
    const p = coord.request({ versionId: 1392, usfm: 'JHN.13' }, () => NOW);
    coord.cancel(); // leaving the reader
    f.release('JHN.13', payload('JHN.13', 'https://cdn.example/jhn13.mp3'));
    expect((await p).kind).toBe('stale');
  });

  it('aborts the superseded request instead of leaving it racing', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const impl = ((_url: string, init?: { signal?: AbortSignal }) => {
      seen.push(init?.signal);
      return new Promise<Response>(() => { /* never settles */ });
    }) as unknown as typeof fetch;
    const coord = createCapabilityCoordinator({ baseUrl: 'https://api.example', fetchImpl: impl });
    void coord.request({ versionId: 1392, usfm: 'JHN.13' }, () => NOW);
    void coord.request({ versionId: 1392, usfm: 'PSA.90' }, () => NOW);
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
  });

  it('bumps its generation on every request and on cancel', () => {
    const impl = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const coord = createCapabilityCoordinator({ baseUrl: 'https://api.example', fetchImpl: impl });
    const g0 = coord.generation();
    void coord.request({ versionId: 1392, usfm: 'JHN.13' }, () => NOW);
    expect(coord.generation()).toBe(g0 + 1);
    coord.cancel();
    expect(coord.generation()).toBe(g0 + 2);
  });
});

describe('a response about the WRONG chapter is refused even if it is the only one (R2)', () => {
  it('does not accept a crossed payload and does not relabel it', async () => {
    const impl = (async () => jsonResponse(payload('JHN.13', 'https://cdn.example/jhn13.mp3'))) as unknown as typeof fetch;
    const out = await fetchChapterCapability({
      baseUrl: 'https://api.example',
      identity: { versionId: 1392, usfm: 'PSA.90' },
      now: () => NOW,
      fetchImpl: impl,
    });
    expect(out.kind).toBe('unavailable');
    if (out.kind === 'unavailable') {
      expect(out.status).toBe('temporarily_unavailable');
      expect(out.diagnostic).toContain('IDENTITY_MISMATCH');
    }
  });
});

describe('failures degrade honestly and never leak raw text to the surface (R5)', () => {
  it('retries one transient transport or backend response and accepts a fresh capability', async () => {
    const temporary = {
      identity: { versionId: 1392, usfm: 'PSA.90' }, text: false, audio: false, offline: false,
      status: 'temporarily_unavailable', reason: '暫時無法取得，稍後可再試',
    };
    for (const firstResult of ['transport', 'backend', 'body-read'] as const) {
      let calls = 0;
      const impl = (async () => {
        calls += 1;
        if (calls === 1 && firstResult === 'transport') throw new Error('transient transport');
        if (calls === 1 && firstResult === 'body-read') return { ok: true, status: 200, json: async () => { throw new TypeError('transient body read'); } } as unknown as Response;
        return jsonResponse(calls === 1 ? temporary : payload('PSA.90', 'https://cdn.example/psa90.mp3'));
      }) as unknown as typeof fetch;
      const out = await fetchChapterCapability({
        baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: impl,
      });
      expect(out.kind).toBe('playable');
      expect(calls).toBe(2);
    }
  });

  it('does not retry explicit absence or authentication failures', async () => {
    const explicit = vi.fn(async () => jsonResponse({
      identity: { versionId: 1392, usfm: 'PSA.90' }, text: true, audio: false, offline: false,
      status: 'explicit_no_audio', reason: '這一章沒有朗讀',
    }));
    const absent = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: explicit,
    });
    expect(absent.kind).toBe('unavailable');
    expect(explicit).toHaveBeenCalledTimes(1);
    for (const status of [401, 403]) {
      const auth = vi.fn(async () => ({ ok: false, status, json: async () => ({ error: 'AUTH_REQUIRED' }) }) as unknown as Response);
      const out = await fetchChapterCapability({
        baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: auth,
      });
      expect(out.kind).toBe('unavailable');
      expect(auth).toHaveBeenCalledTimes(1);
    }
    const malformed = vi.fn(async () => jsonResponse({}));
    const invalid = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: malformed,
    });
    expect(invalid.kind).toBe('unavailable');
    expect(malformed).toHaveBeenCalledTimes(1);

    let throttledCalls = 0;
    const throttled = (async () => {
      throttledCalls += 1;
      return throttledCalls === 1
        ? ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }), json: async () => ({}) } as unknown as Response)
        : jsonResponse(payload('PSA.90', 'https://cdn.example/psa90.mp3'));
    }) as unknown as typeof fetch;
    const recoveredThrottle = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: throttled,
    });
    expect(recoveredThrottle.kind).toBe('playable');
    expect(throttledCalls).toBe(2);

    const noRetryAfter = vi.fn(async () => ({ ok: false, status: 429, headers: new Headers(), json: async () => ({}) }) as unknown as Response);
    await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: noRetryAfter,
    });
    expect(noRetryAfter).toHaveBeenCalledTimes(1);
  });

  it('does not issue a second request when the caller aborts during retry backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return jsonResponse({ identity: { versionId: 1392, usfm: 'PSA.90' }, text: false, audio: false, offline: false, status: 'temporarily_unavailable', reason: '' });
    }) as unknown as typeof fetch;
    const pending = fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: impl, signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(calls).toBe(1);
    vi.useRealTimers();
  });

  it('maps a thrown network error to temporarily_unavailable with a zh-TW message', async () => {
    const impl = (async () => { throw new Error('Network request failed'); }) as unknown as typeof fetch;
    const out = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: impl,
    });
    expect(out.kind).toBe('unavailable');
    if (out.kind === 'unavailable') {
      expect(out.status).toBe('temporarily_unavailable');
      expect(out.retryable).toBe(true);
      expect(out.message).toBe('暫時無法取得，稍後可再試');
      // the raw text is kept for diagnostics only, and is NOT the rendered message
      expect(out.message).not.toContain('Network request failed');
      expect(out.diagnostic).toContain('Network request failed');
    }
  });

  it('maps a non-200 to temporarily_unavailable, never to "no recording exists"', async () => {
    const impl = (async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const out = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: impl,
    });
    expect(out.kind).toBe('unavailable');
    if (out.kind === 'unavailable') {
      expect(out.status).not.toBe('explicit_no_audio');
      expect(out.message).not.toContain('503');
    }
  });

  it('passes through a genuine explicit_no_audio so the reader is told the truth', async () => {
    const impl = (async () => jsonResponse({
      identity: { versionId: 1392, usfm: 'PSA.90' },
      text: true, audio: false, offline: false, status: 'explicit_no_audio', reason: '這一章沒有朗讀',
    })) as unknown as typeof fetch;
    const out = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: impl,
    });
    expect(out.kind).toBe('unavailable');
    if (out.kind === 'unavailable') {
      expect(out.status).toBe('explicit_no_audio');
      expect(out.retryable).toBe(false);
    }
  });

  it('refuses an EXPIRED capability at the client too, so the server is not the only gate (R3)', async () => {
    const impl = (async () => jsonResponse({
      ...payload('PSA.90', 'https://cdn.example/psa90.mp3'), validUntil: '2026-09-11T00:00:00Z',
    })) as unknown as typeof fetch;
    const out = await fetchChapterCapability({
      baseUrl: 'https://api.example', identity: { versionId: 1392, usfm: 'PSA.90' }, now: () => NOW, fetchImpl: impl,
    });
    expect(out.kind).toBe('unavailable');
    if (out.kind === 'unavailable') expect(out.diagnostic).toContain('EXPIRED');
  });
});
