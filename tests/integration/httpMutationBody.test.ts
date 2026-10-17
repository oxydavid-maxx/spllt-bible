import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createHttpServer } from '../../server/http';

describe('HTTP mutation body handling', () => {
  afterEach(() => vi.unstubAllEnvs());

  // The PATCH route this used (in-app prize editing) was removed on 2026-10-17; a PUT body takes the same path.
  it('passes a PUT body through to the route over real HTTP', async () => {
    const database = createDatabase({ members: [{ id: 'http-member', displayName: 'HTTP Member', groupId: 'isolated' }] });
    const backend = createHttpServer({ database, fixtureToken: 'http-fixture-token' });
    await new Promise<void>((resolve, reject) => {
      backend.server.once('listening', () => resolve());
      backend.server.once('error', reject);
      backend.server.listen(0, '127.0.0.1');
    });

    try {
      const address = backend.server.address();
      if (!address || typeof address === 'string') throw new Error('HTTP_TEST_ADDRESS_MISSING');
      const headers = { authorization: 'Bearer http-fixture-token', 'x-qingmu-member-id': 'http-member', 'content-type': 'application/json' };
      const url = `http://127.0.0.1:${address.port}/api/me/congregation`;
      const saved = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ congregation: 'main' }) });
      expect({ status: saved.status, body: await saved.json() }).toEqual({ status: 200, body: { congregation: 'main' } });
      const read = await fetch(url, { headers });
      await expect(read.json()).resolves.toEqual({ congregation: 'main' });
      const refused = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ congregation: 'adult' }) });
      expect(refused.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => backend.server.close(() => resolve()));
    }
  });
});
