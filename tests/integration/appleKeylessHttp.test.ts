import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createHttpServer } from '../../server/http';

// Verify production HTTP wiring without contacting an identity provider. Real JWT rejection
// (signature/audience/issuer/expiry/nonce) is covered by appleVerifier.test.ts.
const verify = vi.hoisted(() => vi.fn(async (_token: string, _options: { nonce: string }) => ({ provider: 'apple' as const, subject: 'synthetic-http-subject' })));
vi.mock('../../server/appleVerifier', () => ({ verifyAppleIdToken: verify }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); verify.mockClear(); });

it('enables public Apple login with public-key verification and deletes its account without private-key configuration', async () => {
  for (const name of Object.keys(process.env)) if (name.startsWith('QINGMU_') || name.startsWith('EXPO_PUBLIC_')) vi.stubEnv(name, '');
  vi.stubEnv('QINGMU_GOOGLE_SERVER_CLIENT_ID', 'synthetic-google-client');
  vi.stubEnv('QINGMU_SESSION_SECRET', 'synthetic-session-secret');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  let origin = '';
  const realFetch = globalThis.fetch;
  const externalAttempts: string[] = [];
  // Install before construction: chapter-audio prewarming captures fetch then,
  // even though its first timer runs later. Empty Bible data is intentional here.
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (!origin || new URL(String(input)).origin !== origin) {
      externalAttempts.push(new URL(String(input)).origin);
      throw Error('EXTERNAL_NETWORK_FORBIDDEN');
    }
    return realFetch(input, init);
  });
  const db = createDatabase({ readingDays: [] });
  const backend = createHttpServer({ database: db });
  await new Promise<void>((resolve, reject) => { backend.server.once('error', reject); backend.server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = backend.server.address();
    if (!address || typeof address === 'string' || address.port === 8788) throw Error('ISOLATED_HTTP_ADDRESS_REQUIRED');
    origin = `http://127.0.0.1:${address.port}`;
    const challenge = await fetch(`${origin}/api/session/apple/challenge`, { method: 'POST' });
    expect(challenge.status).toBe(200);
    const { nonce } = await challenge.json();
    const login = await fetch(`${origin}/api/session/apple`, { method: 'POST', headers: { authorization: 'Bearer synthetic-id-token', 'content-type': 'application/json' }, body: JSON.stringify({ nonce }) });
    expect(login.status).toBe(200);
    expect(verify).toHaveBeenCalledExactlyOnceWith('synthetic-id-token', { nonce });
    const session = await login.json();
    const deleted = await fetch(`${origin}/api/me`, { method: 'DELETE', headers: { authorization: `Bearer ${session.sessionToken}`, 'content-type': 'application/json' }, body: '{"confirmed":true}' });
    expect(deleted.status).toBe(200);
    expect(db.db.prepare('SELECT * FROM members').all()).toEqual([]);
    expect(warn.mock.calls).toEqual([['Apple token 未撤銷', { reason: 'PRIVATE_KEY_NOT_CONFIGURED' }]]);
    expect(externalAttempts).toEqual([]);
  } finally { await backend.stop(); }
});
