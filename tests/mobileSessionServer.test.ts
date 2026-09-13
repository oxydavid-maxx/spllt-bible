import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../server/db';
import { createApiHandler } from '../server/routes';
import { createSessionToken } from '../server/session';

let db: ReturnType<typeof createDatabase>;
let api: ReturnType<typeof createApiHandler>;
const secret = 'synthetic-session-signing-secret';
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
async function login(member = 'A', persistent = true) {
  return api({ method: 'POST', url: '/api/session/google', headers: headers(`test-google-${member}`), body: JSON.stringify(persistent ? { session_type: 'device' } : {}) });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-13T00:00:00Z');
  db = createDatabase({ filename: ':memory:', members: [{ id: 'A', displayName: 'Test A', groupId: 'G' }, { id: 'B', displayName: 'Test B', groupId: 'G' }] });
  api = createApiHandler({ db, sessionSecret: secret, productionGoogleAuth: {
    verify: async token => { if (!['test-google-A', 'test-google-B'].includes(token)) throw new Error('invalid synthetic Google token'); return { subject: token.slice(-1), provider: 'google' }; },
    resolveMember: async identity => identity.subject,
  } });
});
afterEach(() => { db.close(); vi.useRealTimers(); });
describe('revocable persistent mobile session, preserving legacy login', () => {
  it('issues an opaque device credential and accepts it after one hour and the next day', async () => {
    const result = await login();
    expect(result.status).toBe(200); expect(result.body.sessionKind).toBe('device'); expect(result.body.expiresInSeconds).toBeNull();
    const token = String(result.body.sessionToken); expect(token.startsWith('qmd_')).toBe(true);
    for (const time of ['2026-09-13T01:00:01Z', '2026-09-14T12:00:00Z']) {
      vi.setSystemTime(time);
      expect((await api({ method: 'GET', url: '/api/me/profile', headers: { ...headers(token), 'x-qingmu-member-id': 'B' } })).body.memberId).toBe('A');
    }
    const rows = db.db.prepare('SELECT token_hash FROM auth_sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1); expect(rows[0].token_hash.length).toBe(64); expect(rows[0].token_hash === token).toBe(false);
  });
  it('revokes exactly the presented device session and leaves a later same-member session active', async () => {
    const a = await login(), b = await login();
    const first = String(a.body.sessionToken), second = String(b.body.sessionToken);
    expect(first === second).toBe(false);
    expect((await api({ method: 'POST', url: '/api/session/revoke', headers: headers(first) })).status).toBe(200);
    expect((await api({ method: 'GET', url: '/api/me/profile', headers: headers(first) })).status).toBe(401);
    expect((await api({ method: 'GET', url: '/api/me/profile', headers: headers(second) })).status).toBe(200);
    expect((await api({ method: 'POST', url: '/api/session/revoke', headers: headers(first) })).status).toBe(200);
  });
  it('checks account disablement on every persistent session request', async () => {
    const result = await login(); expect(result.body.sessionKind).toBe('device');
    db.db.prepare('UPDATE members SET disabled_at = ? WHERE id = ?').run(1, 'A');
    expect((await api({ method: 'GET', url: '/api/me/profile', headers: headers(String(result.body.sessionToken)) })).status).toBe(401);
    expect((await login()).status).toBe(403);
  });
  it('retains old APK one-hour responses and upgrades only a still-valid legacy credential', async () => {
    const legacy = await login('A', false); expect(legacy.status).toBe(200); expect(legacy.body.expiresInSeconds).toBe(3600);
    const token = String(legacy.body.sessionToken); expect(token.startsWith('qms_')).toBe(true);
    const upgraded = await api({ method: 'POST', url: '/api/session/device', headers: headers(token) });
    expect(upgraded.status).toBe(200); expect(upgraded.body.sessionKind).toBe('device');
    vi.setSystemTime('2026-09-14T12:00:00Z');
    expect((await api({ method: 'POST', url: '/api/session/device', headers: headers(token) })).status).toBe(401);
    expect((await api({ method: 'GET', url: '/api/me/profile', headers: headers(String(upgraded.body.sessionToken)) })).status).toBe(200);
  });
  it('can revoke a valid legacy credential without changing its expiry validation', async () => {
    const token = createSessionToken('A', secret);
    expect((await api({ method: 'POST', url: '/api/session/revoke', headers: headers(token) })).status).toBe(200);
    expect((await api({ method: 'GET', url: '/api/me/profile', headers: headers(token) })).status).toBe(401);
  });
});
