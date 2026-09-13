import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

describe('pilot instance health boundary', () => {
  it('exposes only non-sensitive instance identity before auth', async () => {
    const database = createDatabase();
    const api = createApiHandler({ db: database, instanceId: 'pilot-test-instance', authMode: 'google-only' });
    const response = await api({ method: 'GET', url: '/api/health', headers: {} });

    expect(response).toEqual({
      status: 200,
      body: { status: 'ok', instanceId: 'pilot-test-instance', authMode: 'google-only' },
    });
    database.close();
  });
});
