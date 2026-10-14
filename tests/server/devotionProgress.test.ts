import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

// 積分頁 團體 / 個人 (維護者 2026-10-14). 靈修 earns no points and is never part of a group number.

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup(memberCount = 3, now = '2026-10-14T04:00:00.000Z') {
  const members = Array.from({ length: memberCount }, (_, index) => ({ id: `member-${index}`, displayName: `學生${index}`, groupId: 'g' }));
  const database = createDatabase({ members });
  databases.push(database);
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', now: () => new Date(now) });
  const headers = (memberId = 'member-0') => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  return { database, api, headers };
}

type Database = ReturnType<typeof setup>['database'];
function read(database: Database, memberId: string, taskDate: string) {
  database.db.prepare('INSERT INTO completions(member_id, plan_id, task_date, status, revision, sync_status, last_operation_id) VALUES(?,?,?,?,?,?,?)')
    .run(memberId, `church-${taskDate.slice(0, 7)}`, taskDate, 'COMPLETED', 1, 'CONFIRMED', null);
}
function award(database: Database, memberId: string, taskDate: string, amount = 1) {
  database.db.prepare(`INSERT INTO daily_point_entitlements(member_id, task_date, plan_id, amount, active, completion_revision, source_policy_version, first_awarded_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(memberId, taskDate, `church-${taskDate.slice(0, 7)}`, amount, 1, 1, 'reading-daily-v1', 0, 0);
}
const dates = (from: number, to: number, month = '2026-10') => Array.from({ length: to - from + 1 }, (_, index) => `${month}-${String(from + index).padStart(2, '0')}`);

describe('靈修 days', () => {
  it('marks a day once, lists it, and undoes it', async () => {
    const { api, headers } = setup();
    for (let index = 0; index < 2; index += 1) expect((await api({ method: 'PUT', url: '/api/me/devotions/2026-10-14', headers: headers() })).body).toEqual({ taskDate: '2026-10-14', completed: true });
    expect((await api({ method: 'GET', url: '/api/me/devotions?from=2026-10-01&to=2026-10-31', headers: headers() })).body).toEqual({ dates: ['2026-10-14'] });
    expect((await api({ method: 'GET', url: '/api/me/devotions?from=2026-10-01&to=2026-10-31', headers: headers('member-1') })).body).toEqual({ dates: [] });
    await api({ method: 'DELETE', url: '/api/me/devotions/2026-10-14', headers: headers() });
    expect((await api({ method: 'GET', url: '/api/me/devotions?from=2026-10-01&to=2026-10-31', headers: headers() })).body).toEqual({ dates: [] });
  });

  it('can be caught up for today and the six days before, like reading', async () => {
    const { api, headers } = setup();
    expect((await api({ method: 'PUT', url: '/api/me/devotions/2026-10-08', headers: headers() })).status).toBe(200);
    expect((await api({ method: 'PUT', url: '/api/me/devotions/2026-10-07', headers: headers() })).body).toMatchObject({ error: { code: 'OUTSIDE_COMPLETION_WINDOW' } });
    expect((await api({ method: 'PUT', url: '/api/me/devotions/2026-10-15', headers: headers() })).status).toBe(400);
    expect((await api({ method: 'PUT', url: '/api/me/devotions/2026-10-14', headers: {} })).status).toBe(401);
  });

  it('earns no points and enters no group count', async () => {
    const { database, api, headers } = setup();
    await api({ method: 'PUT', url: '/api/me/devotions/2026-10-14', headers: headers('member-0') });
    await api({ method: 'PUT', url: '/api/me/devotions/2026-10-14', headers: headers('member-1') });
    expect(database.db.prepare('SELECT COUNT(*) AS n FROM daily_point_entitlements').get()).toMatchObject({ n: 0 });
    const group = (await api({ method: 'GET', url: '/api/points/group', headers: headers() })).body as { todayReaders: number | null };
    expect(group.todayReaders).toBeNull();
  });
});

describe('GET /api/points/group', () => {
  it('counts readers per day and hides a day with fewer than two', async () => {
    const { database, api, headers } = setup(4);
    for (const member of ['member-0', 'member-1', 'member-2']) read(database, member, '2026-10-13');
    read(database, 'member-0', '2026-10-12');
    for (const member of ['member-1', 'member-2']) read(database, member, '2026-10-14');
    const body = (await api({ method: 'GET', url: '/api/points/group?month=2026-10', headers: headers() })).body as Record<string, unknown> & { days: Array<{ date: string; readers: number | null }> };
    expect(body).toMatchObject({ month: '2026-10', today: '2026-10-14', todayReaders: 2, yesterdayReaders: 3, monthReads: 5, busiest: { date: '2026-10-13', readers: 3 }, qualifyingDays: 15 });
    expect(body.days).toHaveLength(14);
    expect(body.days.find((day) => day.date === '2026-10-12')).toEqual({ date: '2026-10-12', readers: null });
  });

  it('counts the members who read fifteen days this month toward each prize', async () => {
    const { database, api, headers } = setup(3);
    for (const date of dates(1, 14)) { read(database, 'member-1', date); read(database, 'member-2', date); }
    read(database, 'member-1', '2026-09-30');
    const before = (await api({ method: 'GET', url: '/api/points/group', headers: headers() })).body as { prizes: Array<{ id: string; qualifiedThisMonth: number; achievedMonths: number; members: number; months: number }>; myDaysThisMonth: number };
    expect(before.prizes.map((prize) => [prize.id, prize.members, prize.months, prize.qualifiedThisMonth])).toEqual([['beanbag', 15, 2, 0], ['sofa', 20, 4, 0]]);
    expect(before.myDaysThisMonth).toBe(0);
    database.db.prepare("UPDATE completions SET task_date = '2026-10-15' WHERE member_id = 'member-1' AND task_date = '2026-09-30'").run();
    const after = (await api({ method: 'GET', url: '/api/points/group', headers: headers('member-1') })).body as { prizes: Array<{ qualifiedThisMonth: number }>; myDaysThisMonth: number };
    expect(after.prizes[0].qualifiedThisMonth).toBe(1);
    expect(after.myDaysThisMonth).toBe(15);
  });

  it('counts a month toward a prize once enough members qualified', async () => {
    const { database, api, headers } = setup(16, '2026-11-03T04:00:00.000Z');
    for (let index = 0; index < 15; index += 1) for (const date of dates(1, 15)) read(database, `member-${index}`, date);
    const body = (await api({ method: 'GET', url: '/api/points/group', headers: headers() })).body as { prizes: Array<{ id: string; achievedMonths: number }> };
    expect(body.prizes.map((prize) => [prize.id, prize.achievedMonths])).toEqual([['beanbag', 1], ['sofa', 0]]);
  });

  it('rejects a bad or future month', async () => {
    const { api, headers } = setup();
    expect((await api({ method: 'GET', url: '/api/points/group?month=2026-11', headers: headers() })).status).toBe(400);
    expect((await api({ method: 'GET', url: '/api/points/group?month=10', headers: headers() })).status).toBe(400);
  });
});

describe('GET /api/me/score-history', () => {
  it('gives the running points and 靈修 days for every day since the plan began, and each month', async () => {
    const { database, api, headers } = setup();
    const first = (database.db.prepare('SELECT MIN(task_date) AS first FROM reading_days').get() as { first: string }).first;
    award(database, 'member-0', '2026-09-20', 2);
    award(database, 'member-0', '2026-10-13');
    award(database, 'member-1', '2026-10-13', 5);
    await api({ method: 'PUT', url: '/api/me/devotions/2026-10-13', headers: headers() });
    await api({ method: 'PUT', url: '/api/me/devotions/2026-10-14', headers: headers() });
    const body = (await api({ method: 'GET', url: '/api/me/score-history', headers: headers() })).body as { from: string; points: number[]; devotions: number[]; months: Array<{ month: string; points: number; devotionDays: number }> };
    expect(body.from).toBe(first);
    expect(body.points.at(-1)).toBe(3);
    expect(body.devotions.at(-1)).toBe(2);
    expect(body.points).toHaveLength(body.devotions.length);
    expect(body.months.slice(-2)).toEqual([{ month: '2026-09', points: 2, devotionDays: 0 }, { month: '2026-10', points: 1, devotionDays: 2 }]);
  });
});
