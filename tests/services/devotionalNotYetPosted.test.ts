import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createDevotionClient } from '../../src/services/devotionClient';

// 2026-10-19: the server answers today's not-yet-posted 靈修 with a retryable 503 so apps up to 0.5.34 ask
// again; this app reads that answer as 還沒有上傳 (null), exactly like a 404, never as a load failure.
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((done) => done()));

function clientAt(isoNow: string, fetchOverride?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'devotional-empty-'));
  const db = createDatabase({ members: [{ id: 'self', displayName: '自己', groupId: 'g' }] });
  cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const api = createApiHandler({ db, fixtureToken: 'fixture', devotionalDir: dir, songTitle: async () => null, now: () => new Date(isoNow) });
  const fetchImpl = fetchOverride ?? (async (url: string, init: RequestInit = {}) => {
    const reply = await api({ method: init.method ?? 'GET', url: url.replace('https://api.test', ''), headers: { ...(init.headers as Record<string, string>), 'x-qingmu-member-id': 'self' } });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;
  return createDevotionClient({ baseUrl: 'https://api.test', token: 'fixture', memberId: 'self', fetchImpl });
}

describe('today\'s 靈修 before it is posted', () => {
  it('reads the server\'s not-yet-posted answer for today as 還沒有上傳, like any missing day', async () => {
    const client = clientAt('2026-10-18T23:30:00Z'); // 10/19 (一) 07:30 Taipei
    await expect(client.getDevotional('2026-10-19')).resolves.toBeNull();
    await expect(client.getDevotional('2026-10-12')).resolves.toBeNull();
  });

  it('still reports a real server failure as a failure', async () => {
    const failing = (async () => new Response(JSON.stringify({ error: { code: 'API_ERROR' } }), { status: 500 })) as unknown as typeof fetch;
    await expect(clientAt('2026-10-18T23:30:00Z', failing).getDevotional('2026-10-19')).rejects.toMatchObject({ code: 'API_ERROR' });
  });
});
