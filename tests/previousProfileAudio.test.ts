import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../server/db';
import { createApiHandler } from '../server/routes';
import { createSessionToken } from '../server/session';
import { createApiClient } from '../src/services/apiClient';
import { fetchChapterCapability } from '../src/services/contentCapabilityClient';

const secret = 'isolated-deployment-test-secret-never-used-live';
const databases: Array<ReturnType<typeof createDatabase>> = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.unstubAllGlobals(); });

// The server resolves chapter audio live from YouVersion's audio endpoint (server/genericChapterAudio.ts).
// Tests must not depend on the network or on what YouVersion has recorded today: JHN.13 answers with a
// payload captured from that endpoint on 2026-09-28, anything else with the endpoint's "not found" reply.
const recordedJohn13 = readFileSync(new URL('./fixtures/youversion-chapter-audio-1392-JHN.13.json', import.meta.url), 'utf8');
beforeEach(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname !== 'audio-bible.youversionapi.com') throw new Error(`unexpected network request in a memory test: ${url}`);
    if (url.searchParams.get('version_id') === '1392' && url.searchParams.get('reference') === 'JHN.13') return new Response(recordedJohn13, { status: 200 });
    return new Response(JSON.stringify({ response: { code: 404, data: { errors: [{ key: 'audio_bible.reference.not_found' }] } } }), { status: 404 });
  });
});

function assembled() {
  const db = createDatabase({ filename: ':memory:', members: [
    { id: 'test:alice', displayName: 'Alice Student', groupId: 'test:g1' },
    { id: 'test:bob', displayName: 'Bob Student', groupId: 'test:g2' },
  ] });
  databases.push(db);
  const api = createApiHandler({
    db, instanceId: 'memory-test', authMode: 'google-only', sessionSecret: secret,
    productionGoogleAuth: {
      verify: async () => { throw new Error('No real Google credential in memory tests'); },
      resolveMember: async () => null,
    },
  });
  const token = createSessionToken('test:alice', secret);
  const request = (url: string, authorization?: string, memberId = 'test:alice') => api({
    method: 'GET', url, headers: { ...(authorization ? { authorization } : {}), 'x-qingmu-member-id': memberId },
  });
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const result = await api({ method: init?.method ?? 'GET', url: String(input), headers });
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { db, token, request, transport };
}

describe('exact deployed old baseline with minimal audio/profile additions', () => {
  it('keeps both new paths behind the existing production-session authentication boundary', async () => {
    const { request } = assembled();
    for (const url of ['/api/me/profile', '/api/content-capabilities?versionId=1392&usfm=JHN.13']) {
      // Profile errors are { code, retryable } objects now, capability errors still a bare code; the App's
      // clients read either shape (apiClient.ts), so the boundary is the status plus the code.
      const refused = await request(url) as { status: number; body: { error: unknown } };
      expect(refused.status).toBe(401);
      expect(typeof refused.body.error === 'string' ? refused.body.error : (refused.body.error as { code?: string }).code).toBe('AUTH_REQUIRED');
      expect(await request(url, 'Bearer invalid-memory-token')).toMatchObject({ status: 401 });
      const expired = createSessionToken('test:alice', secret, Math.floor(Date.now() / 1000) - 2, 1);
      expect(await request(url, `Bearer ${expired}`)).toMatchObject({ status: 401 });
    }
  });

  it('lets the actual App profile client read the authenticated member from the existing schema', async () => {
    const { token, transport } = assembled();
    const client = createApiClient({ baseUrl: 'http://memory', token, memberId: 'test:alice', fetchImpl: transport });
    expect(await client.getProfile()).toEqual({
      memberId: 'test:alice', displayName: 'Alice Student', avatarUrl: null, groupId: 'test:g1', groupName: null,
      capabilities: { canManageRewards: false, canRedeemRewards: false, canViewAllScores: false },
    });
  });

  it('does not trust a different member header for the returned profile', async () => {
    const { request, token } = assembled();
    expect(await request('/api/me/profile', `Bearer ${token}`, 'test:bob')).toMatchObject({
      status: 200, body: { memberId: 'test:alice', displayName: 'Alice Student' },
    });
  });

  it('returns a real missing-profile state without creating a member or changing data', async () => {
    const { request, db } = assembled();
    const before = db.db.prepare('SELECT count(*) AS n FROM members').get();
    const unknown = createSessionToken('test:missing', secret);
    expect(await request('/api/me/profile', `Bearer ${unknown}`)).toMatchObject({ status: 404, body: { error: 'PROFILE_NOT_FOUND' } });
    expect(db.db.prepare('SELECT count(*) AS n FROM members').get()).toEqual(before);
  });

  it('lets the actual chapter client obtain and validate the requested recorded chapter', async () => {
    const { token, transport } = assembled();
    const result = await fetchChapterCapability({
      baseUrl: 'http://memory', identity: { versionId: 1392, usfm: 'JHN.13' },
      session: { memberId: 'test:alice', sessionToken: token }, fetchImpl: transport,
    });
    expect(result.kind).toBe('playable');
    if (result.kind === 'playable') {
      expect(result.capability.identity).toEqual({ versionId: 1392, usfm: 'JHN.13' });
      expect(result.capability.uri).toMatch(/^https:\/\//);
      expect(result.capability.provenance?.publisher).toBeTruthy();
    }
  });

  it('preserves legacy callers and reports a chapter YouVersion has no recording for as no audio, without a uri', async () => {
    const { request, token } = assembled();
    expect(await request('/api/content-capabilities', `Bearer ${token}`)).toEqual({
      status: 200, body: { status: 'C_PENDING_ACCESS', reason: 'Content authorization is pending', evidenceRefs: [] },
    });
    const missing = await request('/api/content-capabilities?versionId=1392&usfm=TIT.1', `Bearer ${token}`);
    expect(missing).toMatchObject({ status: 200, body: { identity: { versionId: 1392, usfm: 'TIT.1' }, audio: false, status: 'explicit_no_audio' } });
    expect(missing.body).not.toHaveProperty('uri');
  });
});
