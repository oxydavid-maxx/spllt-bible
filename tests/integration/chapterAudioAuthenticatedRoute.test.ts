import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createCapabilityCoordinator, fetchChapterCapability } from '../../src/services/contentCapabilityClient';
import type { CapabilitySession } from '../../src/services/contentCapabilityClient';

// Review 121 C6. The capability client sent NO credentials, and the chapter route sits BEHIND
// authenticate() in server/routes.ts, so an anonymous request is refused with 401 and no backend
// restart would have fixed it. My PREVIEW-APK-READY-120 note described a legacy-payload path instead;
// that description was wrong and is retracted.
//
// These run the REAL protected route in-process over an isolated in-memory database. No real DB file
// is opened, no existing private session is used, and the route is NOT made public.

const NOW = () => Date.parse('2026-09-12T00:00:00Z');
const TEST_TOKEN = 'test-only-session-token';

function harness() {
  // createDatabase with no filename opens ':memory:' - nothing on disk is touched
  const db = createDatabase({ members: [{ id: 'test:self', displayName: '測試成員', groupId: 'A' }] });
  const api = createApiHandler({ db, fixtureToken: TEST_TOKEN });
  /** forwards into the REAL handler, carrying whatever headers the client actually set */
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    const u = new URL(url);
    const r = await api({
      method: 'GET',
      url: u.pathname + u.search,
      headers: (init?.headers ?? {}) as Record<string, string | undefined>,
    });
    return { ok: r.status === 200, status: r.status, json: async () => r.body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { db, api, fetchImpl };
}

const session = (memberId: string, token = TEST_TOKEN): CapabilitySession => ({ memberId, sessionToken: token });

describe('C6 — the chapter request must carry the signed-in identity', () => {
  it('an ANONYMOUS request is refused by the real route, and reported honestly', async () => {
    const { db, fetchImpl } = harness();
    afterEach(() => db.close());
    const out = await fetchChapterCapability({
      baseUrl: 'http://in-process', identity: { versionId: 1392, usfm: 'JHN.13' }, now: NOW, fetchImpl,
    });
    expect(out.kind).toBe('unavailable');
    if (out.kind === 'unavailable') {
      expect(out.status).toBe('temporarily_unavailable');
      expect(out.status).not.toBe('explicit_no_audio');
      expect(out.message).not.toContain('401'); // raw status never reaches the surface
      expect(out.diagnostic).toContain('401');
    }
  });

  it('a signed-in request reaches the chapter branch and returns THAT chapter', async () => {
    const { db, fetchImpl } = harness();
    afterEach(() => db.close());
    const out = await fetchChapterCapability({
      baseUrl: 'http://in-process', identity: { versionId: 1392, usfm: 'PSA.90' }, now: NOW, fetchImpl,
      session: session('test:self'),
    });
    expect(out.kind).toBe('playable');
    if (out.kind === 'playable') {
      expect(out.capability.identity).toEqual({ versionId: 1392, usfm: 'PSA.90' });
      expect(out.capability.uri).toContain('/PSA/90-');
    }
  });

  it('sends exactly the headers the existing API boundary uses', async () => {
    const seen: Record<string, string>[] = [];
    const spy = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers ?? {});
      return { ok: false, status: 401, json: async () => ({ error: 'AUTH_REQUIRED' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await fetchChapterCapability({
      baseUrl: 'http://in-process', identity: { versionId: 1392, usfm: 'JHN.13' }, now: NOW, fetchImpl: spy,
      session: session('test:self'),
    });
    const h = Object.fromEntries(Object.entries(seen[0] ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    expect(h.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(h['x-qingmu-member-id']).toBe('test:self');
  });

  it('hardcodes nothing: with no session it sends no Authorization header at all', async () => {
    const seen: Record<string, string>[] = [];
    const spy = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers ?? {});
      return { ok: false, status: 401, json: async () => ({ error: 'AUTH_REQUIRED' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await fetchChapterCapability({
      baseUrl: 'http://in-process', identity: { versionId: 1392, usfm: 'JHN.13' }, now: NOW, fetchImpl: spy,
    });
    const h = Object.fromEntries(Object.entries(seen[0] ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    expect(h.authorization).toBeUndefined();
    expect(h['x-qingmu-member-id']).toBeUndefined();
  });
});

describe('C6 — a result fetched under one identity never lands on another', () => {
  const inFlight = (fetchImpl: typeof fetch, getSession: () => CapabilitySession | null) =>
    createCapabilityCoordinator({ baseUrl: 'http://in-process', fetchImpl, getSession });

  it('discards an answer when the ACCOUNT is switched mid-flight', async () => {
    const { db, fetchImpl } = harness();
    afterEach(() => db.close());
    let current: CapabilitySession | null = session('test:self');
    const coord = inFlight(fetchImpl, () => current);
    const pending = coord.request({ versionId: 1392, usfm: 'PSA.90' }, NOW);
    current = session('test:other');
    expect((await pending).kind).toBe('stale');
  });

  it('discards an answer when the reader SIGNS OUT mid-flight', async () => {
    const { db, fetchImpl } = harness();
    afterEach(() => db.close());
    let current: CapabilitySession | null = session('test:self');
    const coord = inFlight(fetchImpl, () => current);
    const pending = coord.request({ versionId: 1392, usfm: 'PSA.90' }, NOW);
    current = null;
    expect((await pending).kind).toBe('stale');
  });

  it('discards an answer when the TOKEN is replaced for the same member (re-auth / expiry)', async () => {
    const { db, fetchImpl } = harness();
    afterEach(() => db.close());
    let current: CapabilitySession | null = session('test:self');
    const coord = inFlight(fetchImpl, () => current);
    const pending = coord.request({ versionId: 1392, usfm: 'PSA.90' }, NOW);
    current = session('test:self', 'a-different-token');
    expect((await pending).kind).toBe('stale');
  });

  it('keeps the answer when the session did NOT change, so this is not a blanket refusal', async () => {
    const { db, fetchImpl } = harness();
    afterEach(() => db.close());
    const fixed = session('test:self');
    const coord = inFlight(fetchImpl, () => fixed);
    expect((await coord.request({ versionId: 1392, usfm: 'PSA.90' }, NOW)).kind).toBe('playable');
  });
});

describe('C6 — the protected route was not weakened', () => {
  it('still refuses an anonymous chapter query at the route itself', async () => {
    const { db, api } = harness();
    afterEach(() => db.close());
    const r = await api({ method: 'GET', url: '/api/content-capabilities?versionId=1392&usfm=PSA.90', headers: {} });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('AUTH_REQUIRED');
  });

  it('still refuses an anonymous request for the legacy no-query form', async () => {
    const { db, api } = harness();
    afterEach(() => db.close());
    expect((await api({ method: 'GET', url: '/api/content-capabilities', headers: {} })).status).toBe(401);
  });
});
