import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

interface StatsRow { name: string; monthlyReadingDays: string; earnedTotal: number; redeemableBalance: number; lastReadingDate: string }
type Stats = Record<'youth' | 'main', StatsRow[]>;

function setup(now = '2026-10-17T16:30:00Z', names = ['乙', '甲', '未讀', '成人', '停用', '甲']) {
  const database = createDatabase({ filename: ':memory:', members: names.map((displayName, index) => ({ id: `m${index}`, displayName, groupId: 'g' })) });
  databases.push(database);
  const api = createApiHandler({ db: database, fixtureToken: 'fixture', formRegistrationKey: 'sheet-key', now: () => new Date(now) });
  const headers = (index: number) => ({ authorization: 'Bearer fixture', 'x-qingmu-member-id': `m${index}` });
  const sync = async (body = {}) => {
    const response = await api({ method: 'POST', url: '/api/integrations/reward-sheet', headers: { 'x-qingmu-registration-key': 'sheet-key' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    return response.body as { readingStats: Stats; labels: Record<'youth' | 'main', string[]>; rejected: unknown[] };
  };
  const read = (index: number, date: string, status = 'COMPLETED', plan = 'plan') => database.db.prepare('INSERT INTO completions(member_id, plan_id, task_date, status, revision, sync_status) VALUES(?, ?, ?, ?, 1, ?)').run(`m${index}`, plan, date, status, 'CONFIRMED');
  const award = (index: number, date: string, amount: number, active = 1) => database.db.prepare(`INSERT INTO daily_point_entitlements(member_id, task_date, plan_id, amount, active, completion_revision, source_policy_version, updated_at)
    VALUES(?, ?, 'plan', ?, ?, 1, 'reading-daily-v1', 0)`).run(`m${index}`, date, amount, active);
  const wallet = (index: number, delta: number) => database.db.prepare("INSERT INTO wallet_entries(entry_id, member_id, kind, delta, created_at) VALUES(?, ?, 'LEGACY_OPENING_CREDIT', ?, 0)").run(`wallet-${index}`, `m${index}`, delta);
  return { database, api, headers, sync, read, award, wallet };
}

describe('reading statistics in the existing reward-sheet sync response', () => {
  it('separates congregations, excludes disabled members and uses the roster labels even after a rename', async () => {
    const f = setup();
    await f.api({ method: 'PUT', url: '/api/me/congregation', headers: f.headers(3), body: JSON.stringify({ congregation: 'main' }) });
    f.database.db.prepare("UPDATE members SET disabled_at = 1 WHERE id = 'm4'").run();
    const first = await f.sync();
    f.database.db.prepare("UPDATE members SET display_name = '改名' WHERE id = 'm5'").run();
    const next = await f.sync();
    expect(next.readingStats?.main.map((row) => row.name)).toEqual(['成人']);
    expect(next.readingStats.youth.map((row) => row.name).sort()).toEqual(first.labels.youth.slice().sort());
    expect(next.readingStats.youth.map((row) => row.name)).toContain('甲 (2)');
    expect(JSON.stringify(next.readingStats)).not.toMatch(/停用|改名|m[0-5]/);
  });

  it('counts distinct COMPLETED dates like the group prize card, including zero months, independently of point amounts', async () => {
    const f = setup();
    f.read(0, '2026-09-01'); f.read(0, '2026-09-01', 'COMPLETED', 'other-plan');
    f.read(0, '2026-09-02'); f.read(0, '2026-09-03', 'UNREPORTED');
    f.read(0, '2026-10-17'); f.read(0, '2026-10-18', 'NOT_COMPLETED');
    f.database.db.prepare("INSERT INTO devotion_completions(member_id, task_date, created_at) VALUES('m0', '2026-10-16', 0)").run();
    f.award(0, '2026-09-01', 7); f.award(0, '2026-10-10', 3, 0);
    const result = await f.sync();
    expect(result.readingStats?.youth.find((row) => row.name === '乙')).toMatchObject({ monthlyReadingDays: '9月2, 10月1', earnedTotal: 7 });
    expect(result.readingStats.youth.find((row) => row.name === '未讀')).toMatchObject({ monthlyReadingDays: '9月0, 10月0', lastReadingDate: '' });
    const group = await f.api({ method: 'GET', url: '/api/points/group', headers: f.headers(0) });
    expect(group.body).toMatchObject({ myDaysThisMonth: 1 });
  });

  it('ends at the current Taipei month, includes empty months through a year boundary and formats the last completion date', async () => {
    const f = setup('2026-12-31T16:01:00Z');
    f.read(0, '2026-10-17');
    f.read(0, '2026-12-31', 'UNREPORTED');
    expect((await f.sync()).readingStats?.youth.find((row) => row.name === '乙')).toMatchObject({ monthlyReadingDays: '9月0, 10月1, 11月0, 12月0, 1月0', lastReadingDate: '20261017 (六)' });
  });

  it('sorts by total points descending then roster name, and returns the same total and post-redemption balance as the app', async () => {
    const f = setup();
    f.award(0, '2026-10-17', 23); f.wallet(0, 23);
    f.award(1, '2026-10-17', 23); f.wallet(1, 23);
    f.award(5, '2026-10-17', 40); f.wallet(5, 40);
    const response = await f.sync({ youth: { rewards: [], redemptions: [{ row: 3, date: '2026-10-17', name: '乙', reward: '書籤', points: 8 }] } });
    expect(response.readingStats?.youth.slice(0, 3).map((row) => [row.name, row.earnedTotal])).toEqual([['甲 (2)', 40], ['乙', 23], ['甲', 23]]);
    const row = response.readingStats.youth.find((entry) => entry.name === '乙')!;
    const profile = (await f.api({ method: 'GET', url: '/api/points/profiles/m0?scope=me', headers: f.headers(0) })).body;
    expect(row.redeemableBalance).toBe(15);
    expect(profile).toMatchObject({ earnedTotal: row.earnedTotal, private: { redeemableBalance: row.redeemableBalance } });
    expect(response.rejected).toEqual([]);
    expect((await f.sync({ youth: { rewards: [], redemptions: [{ row: 3, date: '2026-10-17', name: '乙', reward: '書籤', points: 99 }] } })).readingStats.youth.find((entry) => entry.name === '乙')?.redeemableBalance).toBe(0);
    expect((await f.sync({ youth: { rewards: [], redemptions: [] } })).readingStats.youth.find((entry) => entry.name === '乙')?.redeemableBalance).toBe(23);
  });
});
