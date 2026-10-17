import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createHttpServer } from '../../server/http';
import { createApiClient } from '../../src/services/apiClient';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('deletes through the public HTTP entry and actual App client, including its DELETE confirmation body', async () => {
  // A new in-memory backend on a kernel-selected loopback port. No production config or traffic.
  for (const name of Object.keys(process.env)) if (name.startsWith('QINGMU_')) vi.stubEnv(name, '');
  vi.stubEnv('QINGMU_FIXTURE_DEFAULT_MEMBER', 'fixture:self');
  const db = createDatabase({ members: [
    { id: 'fixture:self', displayName: '虛構甲', groupId: 'youth' },
    { id: 'fixture:other', displayName: '虛構乙', groupId: 'main' },
  ] });
  const backend = createHttpServer({ database: db, fixtureToken: 'isolated-http-token' });
  await new Promise<void>((resolve, reject) => { backend.server.once('error', reject); backend.server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = backend.server.address();
    if (!address || typeof address === 'string' || address.port === 8788) throw Error('ISOLATED_HTTP_ADDRESS_REQUIRED');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const realFetch = globalThis.fetch;
    const fetchImpl: typeof fetch = async (input, init) => {
      if (new URL(String(input)).origin !== baseUrl) throw Error('EXTERNAL_NETWORK_FORBIDDEN');
      return realFetch(input, init);
    };
    vi.stubGlobal('fetch', fetchImpl);
    const headers = { authorization: 'Bearer isolated-http-token', 'content-type': 'application/json' };
    expect((await fetchImpl(`${baseUrl}/api/me`, { method: 'DELETE', headers, body: '{}' })).status).toBe(400);
    const client = createApiClient({ baseUrl, memberId: 'fixture:self', token: 'isolated-http-token', fetchImpl });
    expect(await client.deleteAccount()).toBe(true);
    expect(db.db.prepare("SELECT * FROM members WHERE id='fixture:self'").get()).toBeUndefined();
    expect(db.db.prepare("SELECT * FROM members WHERE id='fixture:other'").get()?.display_name).toBe('虛構乙');
  } finally { await backend.stop(); }
});
