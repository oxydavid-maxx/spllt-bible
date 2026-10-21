import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createDeviceSession } from '../../server/mobileSessions';
import { createApiHandler } from '../../server/routes';

// 光佑 (2026-10-21): 「截圖所示，看能不能就標註在這裏面？」「全部一樣」. A 管理者 checkbox on 青少讀經統計 and
// 主堂讀經統計: checking a person makes them an administrator with exactly the rights of the owner (全體 (管理),
// 後台規則與文件), unchecking revokes it. The owner comes from the private settings and the sheet can never remove
// him. Google and Apple sign-ins alike; every change is recorded. An older script that sends no column changes nothing.
const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

const ADMIN = { capability: true, all: 200, documents: 200, profileAll: 200 };
const MEMBER = { capability: false, all: 403, documents: 403, profileAll: 403 };

async function setup() {
  const db = createDatabase({ members: [['owner', '光佑'], ['elder', '長輩'], ['youth', '小明']].map(([id, displayName]) => ({ id, displayName, groupId: 'g' })) });
  databases.push(db);
  db.db.prepare('INSERT INTO identity_bindings VALUES(?,?,?,?)').run('google', 'owner-subject', 'owner', '2026-10-01');
  let clock = new Date('2026-10-21T04:00:00Z');
  const api = createApiHandler({ db, fixtureToken: 'fixture', formRegistrationKey: 'sheet-key', adminGoogleSubjects: ['owner-subject'], now: () => clock });
  const as = (memberId: string) => ({ authorization: 'Bearer fixture', 'x-qingmu-member-id': memberId });
  const push = (body: unknown, key = 'sheet-key') => api({ method: 'POST', url: '/api/integrations/reward-sheet', headers: { 'x-qingmu-registration-key': key }, body: JSON.stringify(body) });
  const mark = (...marks: Array<[string, boolean]>) => push({ admins: marks.map(([name, admin]) => ({ name, admin })) });
  const rights = async (memberId: string) => ({
    capability: ((await api({ method: 'GET', url: '/api/me/profile', headers: as(memberId) })).body as { capabilities: { canViewAllScores: boolean } }).capabilities.canViewAllScores,
    all: (await api({ method: 'GET', url: '/api/points/people?scope=all', headers: as(memberId) })).status,
    documents: (await api({ method: 'GET', url: '/api/admin/documents', headers: as(memberId) })).status,
    profileAll: (await api({ method: 'GET', url: '/api/points/profiles/youth?scope=all', headers: as(memberId) })).status,
  });
  const changes = () => db.db.prepare('SELECT member_id, label, change, changed_at FROM sheet_admin_changes ORDER BY change_id').all();
  const setNow = (iso: string) => { clock = new Date(iso); };
  // The sync before: it gives every member their name, which is how a name gets onto the sheet at all.
  expect((await push({})).status).toBe(200);
  return { db, api, push, mark, rights, changes, setNow };
}

describe('管理者 checked in the prize sheet', () => {
  it('makes the person an administrator with the same rights as the owner, and unchecking revokes them', async () => {
    const f = await setup();
    expect(await f.rights('elder')).toEqual(MEMBER);
    expect(await f.rights('owner')).toEqual(ADMIN);
    expect((await f.mark(['長輩', true])).status).toBe(200);
    expect(await f.rights('elder')).toEqual(ADMIN);
    expect(await f.rights('youth')).toEqual(MEMBER);
    expect((await f.mark(['長輩', false])).status).toBe(200);
    expect(await f.rights('elder')).toEqual(MEMBER);
  });

  it('never removes the owner from the private settings, checked or not, and his check is not a sheet grant', async () => {
    const f = await setup();
    await f.mark(['光佑', false]);
    expect(await f.rights('owner')).toEqual(ADMIN);
    // The sheet always shows him checked; sending that back is not a second, sheet-made administrator.
    await f.mark(['光佑', true]);
    await f.mark(['光佑', false]);
    expect(await f.rights('owner')).toEqual(ADMIN);
    expect(f.changes()).toEqual([]);
  });

  it('tells the sheet who is an administrator and whose check comes from the private settings', async () => {
    const f = await setup();
    const response = await f.mark(['長輩', true]);
    const rows = (response.body as { readingStats: { youth: Array<{ name: string; admin: boolean; adminFromSettings: boolean }> } }).readingStats.youth;
    const of = (name: string) => rows.find((row) => row.name === name);
    expect(of('光佑')).toMatchObject({ admin: true, adminFromSettings: true });
    expect(of('長輩')).toMatchObject({ admin: true, adminFromSettings: false });
    expect(of('小明')).toMatchObject({ admin: false, adminFromSettings: false });
  });

  it('works for a member who signs in with Apple', async () => {
    const db = createDatabase({ members: [{ id: 'apple-member', displayName: '王姊妹', groupId: 'g' }] });
    databases.push(db);
    db.db.prepare('INSERT INTO identity_bindings VALUES(?,?,?,?)').run('apple', 'apple-subject', 'apple-member', '2026-10-17');
    const api = createApiHandler({
      db, sessionSecret: 'secret', formRegistrationKey: 'sheet-key', adminGoogleSubjects: ['owner-subject'],
      productionGoogleAuth: { verify: async () => { throw Error('invalid'); }, resolveMember: async () => null },
      productionAppleAuth: { verify: async () => { throw Error('invalid'); } },
    });
    const headers = { authorization: `Bearer ${createDeviceSession(db.db, 'apple-member').sessionToken}` };
    const capability = async () => ((await api({ method: 'GET', url: '/api/me/profile', headers })).body as { capabilities: { canViewAllScores: boolean } }).capabilities.canViewAllScores;
    expect(await capability()).toBe(false);
    expect((await api({ method: 'GET', url: '/api/points/people?scope=all', headers })).status).toBe(403);
    const push = (body: unknown) => api({ method: 'POST', url: '/api/integrations/reward-sheet', headers: { 'x-qingmu-registration-key': 'sheet-key' }, body: JSON.stringify(body) });
    expect((await push({})).status).toBe(200);
    expect((await push({ admins: [{ name: '王姊妹', admin: true }] })).status).toBe(200);
    expect(await capability()).toBe(true);
    expect((await api({ method: 'GET', url: '/api/points/people?scope=all', headers })).status).toBe(200);
  });

  it('records every grant and revoke with who and when, and records nothing when the check did not change', async () => {
    const f = await setup();
    await f.mark(['長輩', true]);
    await f.mark(['長輩', true]);
    f.setNow('2026-10-22T01:30:00Z');
    await f.mark(['長輩', false], ['小明', false]);
    await f.mark(['長輩', false]);
    expect(f.changes()).toEqual([
      { member_id: 'elder', label: '長輩', change: 'grant', changed_at: '2026-10-21T04:00:00.000Z' },
      { member_id: 'elder', label: '長輩', change: 'revoke', changed_at: '2026-10-22T01:30:00.000Z' },
    ]);
  });

  it('leaves every administrator as they were when the push has no 管理者 column (an older script)', async () => {
    const f = await setup();
    await f.mark(['長輩', true]);
    expect((await f.push({ youth: { rewards: [], redemptions: [] } })).status).toBe(200);
    expect((await f.push({})).status).toBe(200);
    expect(await f.rights('elder')).toEqual(ADMIN);
    expect(f.changes()).toHaveLength(1);
  });

  it('ignores a name the app does not know, and leaves a name checked both ways as it was', async () => {
    const f = await setup();
    expect((await f.mark(['不存在的人', true])).status).toBe(200);
    expect((await f.mark(['長輩', true], ['長輩', false])).status).toBe(200);
    expect(await f.rights('elder')).toEqual(MEMBER);
    expect(f.changes()).toEqual([]);
  });

  it('refuses a malformed 管理者 list and changes nothing', async () => {
    const f = await setup();
    for (const admins of ['all', [{ name: '長輩', admin: 'yes' }], [{ admin: true }], [null], Array(10_001).fill({ name: '長輩', admin: true })]) {
      const response = await f.push({ admins });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'INVALID_REWARD_SHEET' });
    }
    expect(await f.rights('elder')).toEqual(MEMBER);
    expect(f.changes()).toEqual([]);
  });

  it('never hands a check left on the sheet to a new member who takes a deleted member\'s name', async () => {
    const f = await setup();
    await f.mark(['長輩', true]);
    const as = { authorization: 'Bearer fixture', 'x-qingmu-member-id': 'elder', 'content-type': 'application/json' };
    expect((await f.api({ method: 'DELETE', url: '/api/me', headers: as, body: '{"confirmed":true}' })).status).toBe(200);
    // Before the next sync rewrites the page, someone new with the same name signs up and gets the freed name.
    f.db.db.prepare("INSERT INTO members(id, display_name, group_id) VALUES('newcomer', '長輩', 'unassigned:newcomer')").run();
    const response = await f.mark(['長輩', true]);
    expect(await f.rights('newcomer')).toEqual(MEMBER);
    const row = (response.body as { readingStats: { youth: Array<{ name: string; admin: boolean; newLabel: boolean }> } }).readingStats.youth.find((entry) => entry.name === '長輩');
    expect(row).toMatchObject({ admin: false, newLabel: true });
    // From the next push on the name is theirs, and a check on it counts.
    await f.mark(['長輩', true]);
    expect(await f.rights('newcomer')).toEqual(ADMIN);
  });

  it('only takes a check from the sheet integration itself', async () => {
    const f = await setup();
    expect((await f.push({ admins: [{ name: '長輩', admin: true }] }, 'wrong-key')).status).toBe(401);
    expect(await f.rights('elder')).toEqual(MEMBER);
  });
});
