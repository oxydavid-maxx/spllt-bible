import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual(['books', 'currentBook', 'personDays']);
    expect(JSON.stringify(response.body)).not.toContain('member-');
    expect(JSON.stringify(response.body)).not.toContain('學生');
  });

  it('is for members only', async () => {
    const { api } = setup(1);
    const response = await api({ method: 'GET', url: '/api/points/community', headers: {} });
    expect(response.status).toBe(401);
  });
});

// The one shared goal the product allows itself. It cannot be failed and it has no deadline: a
// chapter lights up the moment ANY one person has read it, so a week you missed is a week somebody
// else carried, and the only direction the thing moves is forward.

interface BookGoal { book: string; chapters: Array<{ chapter: number; readers: number | null }>; complete: boolean; }
const goal = async (api: ReturnType<typeof setup>['api'], headers: ReturnType<typeof setup>['headers']) =>
  ((await get(api, headers)).body as { currentBook: BookGoal | null }).currentBook;

describe('一起讀完一卷書', () => {
  function qualifiedGroup() {
    const context = setup(12);
    // Qualify the same privacy threshold as the total, using an earlier book's reading day.
    for (let index = 0; index < 12; index += 1) award(context.database, `member-${index}`, '2026-09-08');
    return context;
  }

  it.each([2, 3, 12])('withholds all chapter activity when only one of %i members has read', async (members) => {
    const { database, api, headers } = setup(members);
    award(database, 'member-1', '2026-09-14');
    const response = (await get(api, headers)).body as { currentBook: unknown; personDays: number | null; books: string[] };
    expect(response.currentBook).toBeNull();
    expect(response.personDays).toBeNull();
    expect(response.books).toContain('提前');
  });

  it('withholds chapter activity when too few members remain enabled', async () => {
    const { database, api, headers } = qualifiedGroup();
    database.db.prepare("UPDATE members SET disabled_at=1 WHERE id IN ('member-9','member-10','member-11')").run();
    expect(await goal(api, headers)).toBeNull();
  });

  it('only materializes entitlement rows for dates belonging to the selected book', async () => {
    const { database, api, headers } = qualifiedGroup();
    award(database, 'member-7', '2026-09-14');
    let loadedReaders = 0;
    const prepare = database.db.prepare.bind(database.db);
    const spy = vi.spyOn(database.db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql);
      const all = statement.all.bind(statement);
      vi.spyOn(statement, 'all').mockImplementation((...parameters) => {
        const rows = all(...parameters);
        loadedReaders += rows.filter((row) => 'member_id' in row && 'task_date' in row).length;
        return rows;
      });
      return statement;
    });
    try {
      expect((await goal(api, headers))?.chapters[0].readers).toBe(1);
      expect(loadedReaders).toBe(1);
    } finally { spy.mockRestore(); }
  });

  it('aims at the book that finishes soonest, not the psalms that run all term', async () => {
    const { api, headers } = qualifiedGroup();
    // 2026-09-14 reads 1TI.1, 1TI.2 and PSA.92. Both are current; only one has an end in sight.
    expect((await goal(api, headers))?.book).toBe('提摩太前書');
  });

  it('counts every chapter of it the plan schedules, in order', async () => {
    const { api, headers } = qualifiedGroup();
    expect((await goal(api, headers))?.chapters.map((entry) => entry.chapter)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('lights a chapter for everybody once one person has read it', async () => {
    const { database, api, headers } = qualifiedGroup();
    award(database, 'member-7', '2026-09-14');
    const chapters = (await goal(api, headers))!.chapters;
    expect(chapters.find((entry) => entry.chapter === 1)!.readers).toBe(1);
    expect(chapters.find((entry) => entry.chapter === 2)!.readers).toBe(1);
  });

  it('says nothing rather than zero for a chapter still ahead of everyone', async () => {
    const { database, api, headers } = qualifiedGroup();
    award(database, 'member-7', '2026-09-14');
    expect((await goal(api, headers))!.chapters.find((entry) => entry.chapter === 6)!.readers).toBeNull();
  });

  it('adds up the people who read it, without naming one', async () => {
    const { database, api, headers } = qualifiedGroup();
    for (const index of [1, 4, 9]) award(database, `member-${index}`, '2026-09-14');
    expect((await goal(api, headers))!.chapters.find((entry) => entry.chapter === 1)!.readers).toBe(3);
  });

  it('is finished when every chapter has been read by somebody, by anybody', async () => {
    const { database, api, headers } = qualifiedGroup();
    // Nobody here read the whole book; between the three of them the book is read.
    award(database, 'member-0', '2026-09-14');
    award(database, 'member-1', '2026-09-16');
    award(database, 'member-2', '2026-09-18');
    const finished = (await goal(api, headers))!;
    expect(finished.chapters.every((entry) => entry.readers !== null)).toBe(true);
    expect(finished.complete).toBe(true);
  });

  it('is not finished while one chapter is still dark', async () => {
    const { database, api, headers } = qualifiedGroup();
    award(database, 'member-0', '2026-09-14');
    award(database, 'member-1', '2026-09-16');
    expect((await goal(api, headers))!.complete).toBe(false);
  });

  it('never carries a member identifier', async () => {
    const { database, api, headers } = qualifiedGroup();
    for (let index = 0; index < 12; index += 1) award(database, `member-${index}`, '2026-09-14');
    const body = JSON.stringify((await get(api, headers)).body);
    expect(body).not.toContain('member-');
    expect(body).not.toContain('學生');
  });
});
