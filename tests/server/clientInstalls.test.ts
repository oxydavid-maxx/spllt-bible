import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

// 光佑 (2026-10-21): 「以後能不能紀錄誰用的是什麼版本？」→「可以」. Every phone reports its platform, store
// version, build and running OTA update; the server keeps the newest report per installation with the day it
// was last opened, and only the 全體 (管理) list shows it. An older app that reports nothing works as before.
const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

const INSTALL_A = '0f0e0d0c-0b0a-4908-8706-050403020100';
const INSTALL_B = '1f1e1d1c-1b1a-4918-9716-151413121110';
const UPDATE = '019a3c1e-7d4f-7b2e-9c41-5e8f2abff271';

function setup(adminMemberIds: string[] = ['admin']) {
  const db = createDatabase({ members: ['admin', 'friend', 'elder'].map((id) => ({ id, displayName: `測試${id}`, groupId: 'g' })) });
  databases.push(db);
  let clock = new Date('2026-10-20T23:30:00Z'); // 2026-10-21 07:30 in Taipei
  const api = createApiHandler({ db, fixtureToken: 'fixture', adminMemberIds, now: () => clock });
  const as = (memberId: string, client: Record<string, string> = {}) => ({ authorization: 'Bearer fixture', 'x-qingmu-member-id': memberId, ...client });
  const client = (install: string, platform: string, version: string, build: string, update?: string) => ({
    'x-qingmu-client-install': install, 'x-qingmu-client-platform': platform, 'x-qingmu-client-version': version,
    'x-qingmu-client-build': build, ...(update ? { 'x-qingmu-client-update': update } : {}),
  });
  const people = (viewer: string, scope: 'all' | 'friends') => api({ method: 'GET', url: `/api/points/people?scope=${scope}`, headers: as(viewer) });
  const profile = (memberId: string, headers: Record<string, string>) => api({ method: 'GET', url: '/api/me/profile', headers: as(memberId, headers) });
  const rows = () => db.db.prepare('SELECT install_id, member_id, platform, app_version, app_build, update_id, last_seen_date FROM client_installs ORDER BY install_id').all();
  const setNow = (iso: string) => { clock = new Date(iso); };
  return { db, api, as, client, people, profile, rows, setNow };
}

type PeopleBody = { people: Array<{ memberId: string; client?: unknown }> };
const clientOf = (body: unknown, memberId: string) => (body as PeopleBody).people.find((person) => person.memberId === memberId)?.client;

describe('version log per installation', () => {
  it('records platform, store version, build, running update and the Taipei day it was opened', async () => {
    const f = setup();
    expect((await f.profile('elder', f.client(INSTALL_A, 'android', '0.5.35', '60', UPDATE))).status).toBe(200);
    expect(f.rows()).toEqual([{ install_id: INSTALL_A, member_id: 'elder', platform: 'android', app_version: '0.5.35', app_build: '60', update_id: UPDATE, last_seen_date: '2026-10-21' }]);
  });

  it('keeps one row per installation, the newest report only, and moves the day forward', async () => {
    const f = setup();
    await f.profile('elder', f.client(INSTALL_A, 'android', '0.5.35', '60'));
    f.setNow('2026-10-23T02:00:00Z');
    await f.profile('elder', f.client(INSTALL_A, 'android', '0.5.35', '60', UPDATE));
    expect(f.rows()).toEqual([{ install_id: INSTALL_A, member_id: 'elder', platform: 'android', app_version: '0.5.35', app_build: '60', update_id: UPDATE, last_seen_date: '2026-10-23' }]);
    // A second phone of the same member is a second installation.
    await f.profile('elder', f.client(INSTALL_B, 'ios', '0.5.35', '60'));
    expect(f.rows()).toHaveLength(2);
  });

  // Superseded 2026-10-31 (維護者:「回報表看起來少很多人」): an older app is still served as before, but it now
  // shows up as 「舊版」 instead of not at all (see 'phones too old to report' below).
  it('serves an older app that reports nothing exactly as before', async () => {
    const f = setup();
    const response = await f.profile('elder', {});
    expect(response.status).toBe(200);
    expect(f.rows()).toEqual([]); // no User-Agent of the app and no push registration: nothing to say which phone
  });

  it('records nothing from a malformed report but still answers the request', async () => {
    const f = setup();
    for (const bad of [
      f.client('not-a-uuid', 'android', '0.5.35', '60'),
      f.client(INSTALL_A, 'windows', '0.5.35', '60'),
      f.client(INSTALL_A, 'android', '0.5.35; drop', '60'),
      f.client(INSTALL_A, 'android', '0.5.35', 'sixty'),
      f.client(INSTALL_A, 'android', '0.5.35', '60', 'bff271'),
    ]) expect((await f.profile('elder', bad)).status).toBe(200);
    expect(f.rows()).toEqual([]);
  });

  it('does not record a request the server refuses', async () => {
    const f = setup();
    await f.api({ method: 'GET', url: '/api/me/profile', headers: { authorization: 'Bearer wrong', 'x-qingmu-member-id': 'elder', ...f.client(INSTALL_A, 'android', '0.5.35', '60') } });
    expect(f.rows()).toEqual([]);
  });
});

describe('only administrators see it', () => {
  it('shows each person\'s newest installation on 全體 (管理)', async () => {
    const f = setup();
    await f.profile('elder', f.client(INSTALL_B, 'ios', '0.5.34', '59'));
    f.setNow('2026-10-21T03:00:00Z');
    await f.profile('elder', f.client(INSTALL_A, 'android', '0.5.35', '60', UPDATE));
    const response = await f.people('admin', 'all');
    expect(response.status).toBe(200);
    expect(clientOf(response.body, 'elder')).toEqual({ platform: 'android', version: '0.5.35', build: '60', updateId: UPDATE, lastSeenDate: '2026-10-21' });
    expect(clientOf(response.body, 'friend')).toBeNull();
  });

  it('never puts it in a friend\'s view or lets a member ask for 全體', async () => {
    const f = setup();
    await f.profile('elder', f.client(INSTALL_A, 'android', '0.5.35', '60'));
    f.db.db.prepare("INSERT INTO friendships(member_low, member_high, created_at, created_by, operation_id) VALUES('elder', 'friend', 1, 'friend', 'op-friend')").run();
    const friends = await f.people('friend', 'friends');
    expect(friends.status).toBe(200);
    expect(JSON.stringify(friends.body)).not.toContain('0.5.35');
    expect((await f.people('friend', 'all')).status).toBe(403);
    const view = await f.api({ method: 'GET', url: '/api/points/profiles/elder?scope=friends', headers: f.as('friend') });
    expect(JSON.stringify(view.body)).not.toContain('0.5.35');
  });

  it('deletes the rows with the account', async () => {
    const f = setup();
    await f.profile('elder', f.client(INSTALL_A, 'android', '0.5.35', '60'));
    const deleted = await f.api({ method: 'DELETE', url: '/api/me', headers: { ...f.as('elder', f.client(INSTALL_A, 'android', '0.5.35', '60')), 'content-type': 'application/json' }, body: '{"confirmed":true}' });
    expect(deleted.status).toBe(200);
    expect(f.rows()).toEqual([]);
  });
});

// 維護者 2026-10-31:「回報表看起來少很多人」. The report headers only arrived with the 10/21 OTA, so 11 of 20 members
// (a fresh install of the store build, every older build) were missing from 全體 and the prize sheet.
describe('phones too old to report', () => {
  const ANDROID_AGENT = { 'user-agent': 'okhttp/4.12.0' };
  const IOS_AGENT = { 'user-agent': '%E7%AB%B9%E7%A7%91%E8%81%96%E7%B6%93/60 CFNetwork/1568.100.1 Darwin/24.0.0' };
  const pushRegistration = (db: { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }, memberId: string, platform: string) =>
    db.db.prepare('INSERT INTO device_delivery_tokens(installation_id, member_id, platform, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`inst-${memberId}`, memberId, platform, 'token', '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z');

  it('records 「舊版」 with the platform the phone\'s networking names, once a day', async () => {
    const f = setup();
    await f.profile('elder', ANDROID_AGENT);
    await f.profile('friend', IOS_AGENT);
    expect(f.rows()).toEqual([
      { install_id: 'legacy:elder:android', member_id: 'elder', platform: 'android', app_version: '舊版', app_build: null, update_id: null, last_seen_date: '2026-10-21' },
      { install_id: 'legacy:friend:ios', member_id: 'friend', platform: 'ios', app_version: '舊版', app_build: null, update_id: null, last_seen_date: '2026-10-21' },
    ]);
    const writes = () => (f.db.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = writes();
    await f.profile('elder', ANDROID_AGENT);
    expect(writes()).toBe(before);
    f.setNow('2026-10-23T02:00:00Z');
    await f.profile('elder', ANDROID_AGENT);
    expect(f.rows()[0]).toMatchObject({ install_id: 'legacy:elder:android', last_seen_date: '2026-10-23' });
  });

  it('falls back to the member\'s push registration, and records nothing for a browser or script with none', async () => {
    const f = setup();
    pushRegistration(f.db, 'elder', 'IOS');
    await f.profile('elder', { 'user-agent': 'node' });
    await f.profile('friend', { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' });
    expect(f.rows()).toEqual([
      { install_id: 'legacy:elder:ios', member_id: 'elder', platform: 'ios', app_version: '舊版', app_build: null, update_id: null, last_seen_date: '2026-10-21' },
    ]);
  });

  it('shows 「舊版」 on 全體 until the same phone reports its version, which replaces it', async () => {
    const f = setup();
    await f.profile('elder', ANDROID_AGENT);
    expect(clientOf((await f.people('admin', 'all')).body, 'elder')).toEqual({ platform: 'android', version: '舊版', build: null, updateId: null, lastSeenDate: '2026-10-21' });
    await f.profile('elder', { ...ANDROID_AGENT, ...f.client(INSTALL_A, 'android', '0.5.35', '60', UPDATE) });
    expect(f.rows()).toEqual([{ install_id: INSTALL_A, member_id: 'elder', platform: 'android', app_version: '0.5.35', app_build: '60', update_id: UPDATE, last_seen_date: '2026-10-21' }]);
    expect(clientOf((await f.people('admin', 'all')).body, 'elder')).toMatchObject({ version: '0.5.35' });
  });

  it('prefers a real report over a 「舊版」 row of another phone opened the same day', async () => {
    const f = setup();
    await f.profile('elder', f.client(INSTALL_B, 'ios', '0.5.35', '60'));
    await f.profile('elder', ANDROID_AGENT);
    expect(f.rows()).toHaveLength(2);
    expect(clientOf((await f.people('admin', 'all')).body, 'elder')).toMatchObject({ platform: 'ios', version: '0.5.35' });
  });
});
