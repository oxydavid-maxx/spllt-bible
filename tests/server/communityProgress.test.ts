import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

// What the whole youth group has read so far, shown and nothing more: no target, no reward, no
// "we still need N". It only goes up, so it cannot turn into a quiet accusation on a bad week.

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup(memberCount: number) {
  const members = Array.from({ length: memberCount }, (_, index) => ({
    id: `member-${index}`, displayName: `學生${index}`, groupId: 'g',
  }));
  const database = createDatabase({ members });
  databases.push(database);
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', now: () => new Date('2026-09-14T04:00:00.000Z') });
  const headers = (memberId: string) => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  return { database, api, headers };
}

/** Grant one member one active day, the same row the points total is derived from. */
function award(database: ReturnType<typeof setup>['database'], memberId: string, taskDate: string) {
  database.db.prepare(`INSERT INTO daily_point_entitlements(member_id, task_date, plan_id, amount, active, completion_revision, source_policy_version, first_awarded_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(memberId, taskDate, 'church-2026-09', 1, 1, 1, 'reading-daily-v1', 0, 0);
}

const get = (api: ReturnType<typeof setup>['api'], headers: ReturnType<typeof setup>['headers']) =>
  api({ method: 'GET', url: '/api/points/community', headers: headers('member-0') });

describe('what the group has read together', () => {
  it('names the books the plan has walked through, however few people are using it', async () => {
    const { api, headers } = setup(1);
    const response = await get(api, headers);
    expect(response.status).toBe(200);
    const body = response.body as { books: string[]; personDays: number | null };
    // Derived from the reading plan, not from anybody's record, so it is true on day one.
    expect(body.books.length).toBeGreaterThan(0);
  });

  // With three members, subtracting your own total from the group's tells you the other two. The
  // count is therefore withheld until the group is large enough for that arithmetic to be useless —
  // the same ten-member threshold the tier calculation already uses.
  it('withholds the shared count while it would give away an individual', async () => {
    const { database, api, headers } = setup(3);
    for (const index of [0, 1, 2]) award(database, `member-${index}`, '2026-09-1' + index);
    const body = (await get(api, headers)).body as { personDays: number | null; books: string[] };
    expect(body.personDays).toBeNull();
    expect(body.books.length).toBeGreaterThan(0);
  });

  it('shows the shared count once the group is big enough to hide in', async () => {
    const { database, api, headers } = setup(12);
    for (let index = 0; index < 12; index += 1) award(database, `member-${index}`, '2026-09-08');
    const body = (await get(api, headers)).body as { personDays: number | null };
    expect(body.personDays).toBe(12);
  });

  it('carries no member identifiers at all', async () => {
    const { database, api, headers } = setup(12);
    for (let index = 0; index < 12; index += 1) award(database, `member-${index}`, '2026-09-08');
    const response = await get(api, headers);
    expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual(['books', 'personDays']);
    expect(JSON.stringify(response.body)).not.toContain('member-');
    expect(JSON.stringify(response.body)).not.toContain('學生');
  });

  it('is for members only', async () => {
    const { api } = setup(1);
    const response = await api({ method: 'GET', url: '/api/points/community', headers: {} });
    expect(response.status).toBe(401);
  });
});
