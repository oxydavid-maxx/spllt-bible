import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createDevotionClient } from '../../src/services/devotionClient';

// 青少/主堂 (維護者 2026-10-17): the app's client against the real routes, plus an older server that has no route.
const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function clientFor(memberId: string, ids: string[]) {
  const db = createDatabase({ members: ids.map((id) => ({ id, displayName: `測試${id}`, groupId: 'g' })) });
  databases.push(db);
  const api = createApiHandler({ db, fixtureToken: 'fixture', now: () => new Date('2026-10-17T04:00:00Z') });
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const reply = await api({ method: init.method ?? 'GET', url: url.replace('https://api.test', ''), headers: { ...(init.headers as Record<string, string>), 'x-qingmu-member-id': memberId }, body: init.body as string | undefined });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;
  return { db, client: createDevotionClient({ baseUrl: 'https://api.test', token: 'fixture', memberId, fetchImpl }) };
}

describe('the congregation client', () => {
  it('reads a member from before as 青少 and a new member as not chosen', async () => {
    expect(await clientFor('old', ['old']).client.getCongregation()).toBe('youth');
    const later = clientFor('new', ['old']);
    later.db.db.prepare("INSERT INTO members(id, display_name, group_id) VALUES('new', '新人', 'unassigned:new')").run();
    expect(await later.client.getCongregation()).toBeNull();
  });

  it('saves a choice and reads it back', async () => {
    const { db, client } = clientFor('new', []);
    db.db.prepare("INSERT INTO members(id, display_name, group_id) VALUES('new', '新人', 'unassigned:new')").run();
    expect(await client.setCongregation('main')).toBe('main');
    expect(await client.getCongregation()).toBe('main');
  });

  it('treats an older server without the route as 青少, and never pretends a save went through there', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 })) as unknown as typeof fetch;
    const client = createDevotionClient({ baseUrl: 'https://api.test', token: 't', memberId: 'm', fetchImpl });
    expect(await client.getCongregation()).toBe('youth');
    await expect(client.setCongregation('main')).rejects.toThrow();
  });

  // 積分頁 (維護者 2026-10-20): the group card can look at the other side; without one the server answers the member's own.
  it('asks the group reading for the side looked at, and the member’s own side otherwise', async () => {
    const { db, client } = clientFor('m', ['y', 'm']);
    db.db.prepare("UPDATE member_affiliations SET congregation = 'main' WHERE member_id = 'm'").run();
    expect((await client.getGroupReading('2026-10')).scope).toBe('main');
    expect((await client.getGroupReading('2026-10', 'youth')).scope).toBe('youth');
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => { urls.push(url); return new Response('{}', { status: 500 }); }) as unknown as typeof fetch;
    const recorder = createDevotionClient({ baseUrl: 'https://api.test', token: 't', memberId: 'm', fetchImpl });
    await recorder.getGroupReading('2026-10', 'main').catch(() => undefined);
    await recorder.getGroupReading('2026-10').catch(() => undefined);
    expect(urls).toEqual(['https://api.test/api/points/group?month=2026-10&congregation=main', 'https://api.test/api/points/group?month=2026-10']);
  });

  it('refuses a reply it does not understand', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ congregation: 'adult' }), { status: 200 })) as unknown as typeof fetch;
    const client = createDevotionClient({ baseUrl: 'https://api.test', token: 't', memberId: 'm', fetchImpl });
    await expect(client.getCongregation()).rejects.toThrow();
    await expect(client.setCongregation('main')).rejects.toThrow();
  });
});
