import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

// 獎品與兌換 in one Google Sheet (維護者 2026-10-17): tabs 青少獎品/青少兌換/主堂獎品/主堂兌換. The sheet is the record.
// Redeemable points = reading points minus every redemption row; delete the row and the points come back.
const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

type Side = { rewards?: unknown[]; redemptions?: unknown[] };

function setup(members: Array<[string, string]>) {
  const db = createDatabase({ members: members.map(([id, displayName]) => ({ id, displayName, groupId: 'g' })) });
  databases.push(db);
  const api = createApiHandler({ db, fixtureToken: 'fixture', formRegistrationKey: 'sheet-key', now: () => new Date('2026-10-17T04:00:00Z') });
  const as = (memberId: string) => ({ authorization: 'Bearer fixture', 'x-qingmu-member-id': memberId });
  const push = (body: { youth?: Side; main?: Side }, key = 'sheet-key') => api({ method: 'POST', url: '/api/integrations/reward-sheet', headers: { 'x-qingmu-registration-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const side = (rewards: unknown[] = [], redemptions: unknown[] = []): Side => ({ rewards, redemptions });
  const rewards = async (memberId: string) => ((await api({ method: 'GET', url: '/api/rewards', headers: as(memberId) })).body as { rewards: Array<{ rewardId: string; name: string; costPoints: number }> }).rewards;
  const balance = async (memberId: string) => ((await api({ method: 'GET', url: `/api/points/profiles/${encodeURIComponent(memberId)}?scope=me`, headers: as(memberId) })).body as { private: { redeemableBalance: number } }).private.redeemableBalance;
  const credit = (memberId: string, points: number) => db.db.prepare("INSERT INTO wallet_entries(entry_id, member_id, kind, delta, created_at) VALUES(?, ?, 'READING_CREDIT', ?, 0)").run(`credit-${memberId}-${points}-${Math.random()}`, memberId, points);
  const choose = (memberId: string, congregation: 'youth' | 'main') => api({ method: 'PUT', url: '/api/me/congregation', headers: { ...as(memberId), 'content-type': 'application/json' }, body: JSON.stringify({ congregation }) });
  const join = (id: string, displayName: string) => db.db.prepare('INSERT INTO members(id, display_name, group_id) VALUES(?, ?, ?)').run(id, displayName, `unassigned:${id}`);
  return { db, api, as, push, side, rewards, balance, credit, choose, join };
}

describe('the prize lists', () => {
  it('shows each congregation its own listed prizes, and the in-app list to 青少 until the sheet first arrives', async () => {
    const f = setup([['y', '小明'], ['m', '王姊妹']]);
    await f.choose('m', 'main');
    f.db.db.prepare("INSERT INTO rewards(reward_id, name, cost_points, active, revision, created_at, updated_at, updated_by) VALUES('old', '舊獎品', 30, 1, 1, 0, 0, 'admin')").run();
    expect((await f.rewards('y')).map((r) => r.name)).toEqual(['舊獎品']);
    expect(await f.rewards('m')).toEqual([]);

    const reply = await f.push({
      youth: f.side([{ row: 2, name: '飲料券', points: 50, listed: true }, { row: 3, name: '筆記本', points: 80, listed: false }]),
      main: f.side([{ row: 2, name: '書籤', points: 20, listed: true }]),
    });
    expect(reply.status).toBe(200);
    expect((await f.rewards('y')).map((r) => [r.name, r.costPoints])).toEqual([['飲料券', 50]]);
    expect((await f.rewards('m')).map((r) => [r.name, r.costPoints])).toEqual([['書籤', 20]]);
  });

  it('hands the in-app prizes to the new sheet once, and moves a target to the sheet prize of the same name', async () => {
    const f = setup([['y', '小明']]);
    f.db.db.prepare("INSERT INTO rewards(reward_id, name, cost_points, active, revision, created_at, updated_at, updated_by) VALUES('old', '飲料券', 50, 1, 1, 0, 0, 'admin')").run();
    await f.api({ method: 'PUT', url: '/api/me/reward-target', headers: { ...f.as('y'), 'content-type': 'application/json' }, body: JSON.stringify({ rewardId: 'old' }) });
    const first = (await f.push({ youth: f.side() })).body as { legacyRewards: unknown[] };
    expect(first.legacyRewards).toEqual([{ name: '飲料券', points: 50 }]);
    await f.push({ youth: f.side([{ row: 2, name: '飲料券', points: 50, listed: true }]) });
    const profile = (await f.api({ method: 'GET', url: '/api/points/profiles/y?scope=me', headers: f.as('y') })).body as { private: { targetReward: { name: string; rewardId: string } } };
    expect(profile.private.targetReward.name).toBe('飲料券');
    expect(profile.private.targetReward.rewardId).not.toBe('old');
    expect(((await f.push({ youth: f.side() })).body as { legacyRewards: unknown[] }).legacyRewards).toEqual([]);
  });

  it('lets a member aim only at a prize on their own side', async () => {
    const f = setup([['y', '小明'], ['m', '王姊妹']]);
    await f.choose('m', 'main');
    await f.push({ youth: f.side([{ row: 2, name: '飲料券', points: 50, listed: true }]), main: f.side([{ row: 2, name: '書籤', points: 20, listed: true }]) });
    const youthPrize = (await f.rewards('y'))[0].rewardId;
    const target = (memberId: string) => f.api({ method: 'PUT', url: '/api/me/reward-target', headers: { ...f.as(memberId), 'content-type': 'application/json' }, body: JSON.stringify({ rewardId: youthPrize }) });
    expect((await target('y')).status).toBe(200);
    expect((await target('m')).status).toBe(409);
  });
});

describe('the redemption rows', () => {
  it('takes every row off the reading points, from either tab, and gives them back when the row is deleted', async () => {
    const f = setup([['y', '小明'], ['m', '王姊妹']]);
    await f.choose('m', 'main');
    f.credit('y', 120);
    expect(await f.balance('y')).toBe(120);
    const row = { row: 2, date: '2026-10-12', name: '小明', reward: '飲料券', points: 50 };
    await f.push({ youth: f.side([], [row]), main: f.side([], [{ ...row, points: 20 }]) });
    expect(await f.balance('y')).toBe(50);
    await f.push({ youth: f.side([], []), main: f.side([], []) });
    expect(await f.balance('y')).toBe(120);
  });

  it('shows 0, never a negative number, when the rows take off more than there was', async () => {
    const f = setup([['y', '小明']]);
    f.credit('y', 30);
    await f.push({ youth: f.side([], [{ row: 2, date: '2026-10-12', name: '小明', reward: '飲料券', points: 50 }]) });
    expect(await f.balance('y')).toBe(0);
  });

  it('shows the member their own rows under 我的領取紀錄', async () => {
    const f = setup([['y', '小明']]);
    f.credit('y', 120);
    await f.push({ youth: f.side([], [{ row: 2, date: '2026-10-12', name: '小明', reward: '飲料券', points: 50 }]) });
    const mine = (await f.api({ method: 'GET', url: '/api/me/redemptions', headers: f.as('y') })).body as { redemptions: Array<{ rewardName: string; costPoints: number; status: string; confirmedAt: number }> };
    expect(mine.redemptions).toMatchObject([{ rewardName: '飲料券', costPoints: 50, status: 'COMPLETED' }]);
    expect(new Date(mine.redemptions[0].confirmedAt).toISOString().slice(0, 10)).toBe('2026-10-12');
  });

  it('says which rows did not count, and why', async () => {
    const f = setup([['y', '小明']]);
    f.credit('y', 120);
    const reply = (await f.push({
      youth: f.side(
        [{ row: 2, name: '飲料券', points: 50, listed: true }, { row: 3, name: '飲料券', points: 60, listed: true }, { row: 4, name: '貼紙', points: 'x', listed: true }],
        [
          { row: 2, date: '2026-10-12', name: '沒有這個人', reward: '飲料券', points: 50 },
          { row: 3, date: '10/12', name: '小明', reward: '飲料券', points: 50 },
          { row: 4, date: '2026-10-12', name: '小明', reward: '飲料券', points: 0 },
          { row: 5, date: '2026-10-12', name: '小明', reward: '', points: 10 },
        ],
      ),
    })).body as { rejected: unknown[] };
    expect(reply.rejected).toEqual([
      { side: 'youth', tab: 'rewards', row: 3, field: 'duplicate' },
      { side: 'youth', tab: 'rewards', row: 4, field: 'points' },
      { side: 'youth', tab: 'redemptions', row: 2, field: 'name' },
      { side: 'youth', tab: 'redemptions', row: 3, field: 'date' },
      { side: 'youth', tab: 'redemptions', row: 4, field: 'points' },
      { side: 'youth', tab: 'redemptions', row: 5, field: 'reward' },
    ]);
    expect(await f.balance('y')).toBe(120);
  });
});

describe('the name dropdown', () => {
  it('lists each side its own members, keeps a name once given, and tells two people with one name apart', async () => {
    const f = setup([['y1', '小明'], ['m', '王姊妹']]);
    await f.choose('m', 'main');
    const labels = async () => ((await f.push({})).body as { labels: { youth: string[]; main: string[] } }).labels;
    expect(await labels()).toEqual({ youth: ['小明'], main: ['王姊妹'] });
    f.join('y2', '小明');
    await f.choose('y2', 'youth');
    expect((await labels()).youth).toEqual(['小明', '小明 (2)']);
    f.credit('y1', 100);
    await f.push({ youth: f.side([], [{ row: 2, date: '2026-10-12', name: '小明', reward: '飲料券', points: 40 }]) });
    expect(await f.balance('y1')).toBe(60);
    f.db.db.prepare("UPDATE members SET disabled_at = 1 WHERE id = 'y2'").run();
    expect((await labels()).youth).toEqual(['小明']);
  });
});

describe('who may send the sheet', () => {
  it('refuses a push without the key, and leaves the lists alone', async () => {
    const f = setup([['y', '小明']]);
    expect((await f.push({ youth: f.side([{ row: 2, name: '飲料券', points: 50, listed: true }]) }, 'wrong')).status).toBe(401);
    expect(await f.rewards('y')).toEqual([]);
  });

  it('no longer manages prizes or redemptions in the app', async () => {
    const f = setup([['admin', '管理者']]);
    const api = createApiHandler({ db: f.db, fixtureToken: 'fixture', adminMemberIds: ['admin'], now: () => new Date('2026-10-17T04:00:00Z') });
    const post = (url: string) => api({ method: 'POST', url, headers: { ...f.as('admin'), 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'op', name: 'x', costPoints: 1, memberId: 'admin', rewardId: 'r', expectedRewardRevision: 1 }) });
    expect((await post('/api/admin/rewards')).status).toBe(404);
    expect((await post('/api/admin/redemptions')).status).toBe(404);
    const profile = (await api({ method: 'GET', url: '/api/me/profile', headers: f.as('admin') })).body as { capabilities?: { canManageRewards: boolean; canRedeemRewards: boolean } };
    if (profile.capabilities) expect(profile.capabilities).toMatchObject({ canManageRewards: false, canRedeemRewards: false });
  });
});
