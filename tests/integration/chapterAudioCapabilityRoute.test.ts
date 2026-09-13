import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { validateCapability } from '../../src/domain/chapterAudioContract';
import { fetchChapterCapability } from '../../src/services/contentCapabilityClient';

// In-process integration for review 119 R1/R6: the REAL route, the REAL registry and the REAL client
// validator, wired together. No device, no listening socket, no live 8788, no FCM, no real member data.

function harness() {
  const db = createDatabase({ members: [{ id: 'google:self', displayName: '小明', groupId: 'A' }] });
  const api = createApiHandler({ db, fixtureToken: 'test-token' });
  const headers = { authorization: 'Bearer test-token', 'x-qingmu-member-id': 'google:self' };
  return { db, api, headers };
}

describe('GET /api/content-capabilities — per-chapter (R1)', () => {
  it('answers for the exact chapter asked about, for a chapter that is NOT JHN.13', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    const r = await api({ method: 'GET', url: '/api/content-capabilities?versionId=1392&usfm=PSA.90', headers });
    expect(r.status).toBe(200);
    expect(r.body.audio).toBe(true);
    expect(r.body.identity).toEqual({ versionId: 1392, usfm: 'PSA.90' });
    expect(String(r.body.uri)).toContain('/PSA/90-');
  });

  it('answers for GEN.1, which is outside the September 42 — proving there is no whitelist', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    const r = await api({ method: 'GET', url: '/api/content-capabilities?versionId=1392&usfm=GEN.1', headers });
    expect(r.body.audio).toBe(true);
    expect(String(r.body.uri)).toContain('/GEN/1-');
  });

  it('reports a chapter whose address was never collected as pending, never as no-audio', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    const r = await api({ method: 'GET', url: '/api/content-capabilities?versionId=1392&usfm=TIT.1', headers });
    expect(r.body.audio).toBe(false);
    expect(r.body.status).toBe('pending_observation');
    expect(r.body.uri).toBeUndefined();
  });

  it('does not serve one version\'s recording for another version', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    const r = await api({ method: 'GET', url: '/api/content-capabilities?versionId=312&usfm=JHN.13', headers });
    expect(r.body.audio).toBe(false);
  });

  it('rejects a malformed query instead of guessing', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    expect((await api({ method: 'GET', url: '/api/content-capabilities?versionId=abc&usfm=PSA.90', headers })).status).toBe(400);
    expect((await api({ method: 'GET', url: '/api/content-capabilities?versionId=1392&usfm=oops', headers })).status).toBe(400);
  });
});

describe('the route stays backward compatible (R8)', () => {
  it('still returns the content GATE when asked with no chapter query', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    const r = await api({ method: 'GET', url: '/api/content-capabilities', headers });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('C_PENDING_ACCESS');
  });
});

describe('route output survives the CLIENT validator end to end (R2/R5)', () => {
  it('a real route response is accepted for the chapter it answers for', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    const r = await api({ method: 'GET', url: '/api/content-capabilities?versionId=1392&usfm=JHN.21', headers });
    const check = validateCapability(r.body, { versionId: 1392, usfm: 'JHN.21' }, Date.parse('2026-09-12T00:00:00Z'));
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.capability.provenance.publisher).toBe('Biblica');
  });

  it('and is REFUSED when validated against a different chapter, so a crossed answer cannot land', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    const r = await api({ method: 'GET', url: '/api/content-capabilities?versionId=1392&usfm=JHN.21', headers });
    const check = validateCapability(r.body, { versionId: 1392, usfm: 'PSA.90' }, Date.parse('2026-09-12T00:00:00Z'));
    expect(check.ok).toBe(false);
  });

  it('drives the real client against the real route through an in-process fetch double', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    // a fetch that forwards straight into the handler: real route, real validation, no socket
    const fetchImpl = (async (url: string) => {
      const r = await api({ method: 'GET', url: new URL(url).pathname + new URL(url).search, headers });
      return { ok: r.status === 200, status: r.status, json: async () => r.body } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await fetchChapterCapability({
      baseUrl: 'http://in-process',
      identity: { versionId: 1392, usfm: 'PSA.88' },
      now: () => Date.parse('2026-09-12T00:00:00Z'),
      fetchImpl,
    });
    expect(out.kind).toBe('playable');
    if (out.kind === 'playable') {
      expect(out.capability.identity.usfm).toBe('PSA.88');
      expect(out.capability.provenance.reference).toBe('詩88');
    }
  });

  it('reports an uncollected chapter to the client as pending, with a retryable honest message', async () => {
    const { db, api, headers } = harness();
    afterEach(() => db.close());
    const fetchImpl = (async (url: string) => {
      const r = await api({ method: 'GET', url: new URL(url).pathname + new URL(url).search, headers });
      return { ok: r.status === 200, status: r.status, json: async () => r.body } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await fetchChapterCapability({
      baseUrl: 'http://in-process',
      identity: { versionId: 1392, usfm: '2TI.4' },
      now: () => Date.parse('2026-09-12T00:00:00Z'),
      fetchImpl,
    });
    expect(out.kind).toBe('unavailable');
    if (out.kind === 'unavailable') {
      expect(out.status).toBe('pending_observation');
      expect(out.retryable).toBe(true);
      expect(out.message).toBe('這一章的朗讀還沒取得');
    }
  });
});
