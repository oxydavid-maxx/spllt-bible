import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup() {
  const db = createDatabase({
    members: [
      { id: 'google:self', displayName: '小明', groupId: 'A' },
      { id: 'google:other', displayName: '王小明', groupId: 'A' },
    ],
  });
  databases.push(db);
  return createApiHandler({ db, fixtureToken: 'test-token', now: () => new Date('2026-09-14T04:00:00.000Z') });
}

const headers = {
  authorization: 'Bearer test-token',
  'x-qingmu-member-id': 'google:self',
};

describe('completion API', () => {
  it('accepts a completion and replays the same operation without duplicate points', async () => {
    const api = setup();
    const request = {
      method: 'PUT',
      url: '/api/me/completions/church-2026-09/2026-09-08',
      headers,
      body: JSON.stringify({ operation_id: 'api-op-1', expected_revision: 0, status: 'COMPLETED' }),
    };

    const first = await api(request);
    const replay = await api(request);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
  });

  it('returns a stale revision conflict without overwriting the authoritative state', async () => {
    const api = setup();
    const base = {
      method: 'PUT',
      url: '/api/me/completions/church-2026-09/2026-09-08',
      headers,
    };
    await api({ ...base, body: JSON.stringify({ operation_id: 'api-op-1', expected_revision: 0, status: 'COMPLETED' }) });
    const conflict = await api({ ...base, body: JSON.stringify({ operation_id: 'api-op-2', expected_revision: 0, status: 'NOT_COMPLETED' }) });

    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: { code: 'REVISION_CONFLICT' }, revision: 1, status: 'COMPLETED' });
  });

  it('does not replay an operation response across members or changed commands', async () => {
    const api = setup();
    const selfRequest = {
      method: 'PUT',
      url: '/api/me/completions/church-2026-09/2026-09-08',
      headers,
      body: JSON.stringify({ operation_id: 'shared-operation-id', expected_revision: 0, status: 'COMPLETED' }),
    };
    const first = await api(selfRequest);
    expect(first.status).toBe(200);

    const other = await api({
      ...selfRequest,
      headers: { authorization: 'Bearer test-token', 'x-qingmu-member-id': 'google:other' },
    });
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ error: { code: 'OPERATION_ID_REUSED' } });

    const changed = await api({
      ...selfRequest,
      body: JSON.stringify({ operation_id: 'shared-operation-id', expected_revision: 0, status: 'NOT_COMPLETED' }),
    });
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ error: { code: 'OPERATION_ID_REUSED' } });

    const otherProgress = await api({
      method: 'GET',
      url: '/api/progress?date=2026-09-08',
      headers: { authorization: 'Bearer test-token', 'x-qingmu-member-id': 'google:other' },
    });
    expect(otherProgress.status).toBe(200);
    expect(otherProgress.body).toMatchObject({
      personal: { status: 'UNREPORTED', revision: 0, points: 0 },
    });
  });

  it('does not replay a cached operation after the authoritative row has advanced', async () => {
    const api = setup();
    const base = {
      method: 'PUT',
      url: '/api/me/completions/church-2026-09/2026-09-08',
      headers,
    };
    const first = await api({ ...base, body: JSON.stringify({ operation_id: 'advance-1', expected_revision: 0, status: 'COMPLETED' }) });
    expect(first.status).toBe(200);
    const second = await api({ ...base, body: JSON.stringify({ operation_id: 'advance-2', expected_revision: 1, status: 'NOT_COMPLETED' }) });
    expect(second.status).toBe(200);

    const replay = await api({ ...base, body: JSON.stringify({ operation_id: 'advance-1', expected_revision: 0, status: 'COMPLETED' }) });
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ error: { code: 'OPERATION_REPLAY_STALE' }, revision: 2, status: 'NOT_COMPLETED' });
  });
});
