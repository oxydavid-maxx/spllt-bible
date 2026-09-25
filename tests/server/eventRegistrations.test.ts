import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { deriveFormRegistrationKey } from '../../server/eventRegistrations';

// The sign-up form lives in 光佑's Google Drive. His Apps Script sends only each respondent's name
// and chosen dates (never the LINE ID or age columns). The server keeps only who matched a member
// and how many signed up; unmatched names are dropped. A member sees the count and their friends.

const KEY = 'test-form-registration-key';
const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup() {
  const database = createDatabase({
    members: [
      { id: 'member-self', displayName: '光佑', groupId: 'g1' },
      { id: 'member-friend', displayName: '陳小華', groupId: 'g1' },
      { id: 'member-friend-2', displayName: '大同', groupId: 'g1' },
      { id: 'member-stranger', displayName: '王美美', groupId: 'g1' },
    ],
  });
  databases.push(database);
  for (const other of ['member-friend', 'member-friend-2']) {
    const [low, high] = ['member-self', other].sort();
    database.db.prepare('INSERT INTO friendships(member_low, member_high, created_at, created_by, operation_id) VALUES(?,?,?,?,?)').run(low, high, 1, 'member-self', `op-${other}`);
  }
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', formRegistrationKey: KEY, now: () => new Date('2026-09-25T04:00:00.000Z') });
  const member = (memberId: string) => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  const push = (body: unknown, key = KEY) => api({ method: 'POST', url: '/api/integrations/form-registrations', headers: { 'x-qingmu-registration-key': key }, body: JSON.stringify(body) });
  return { database, api, member, push };
}

const FORM = {
  formTitle: '青年崇拜報名表 ( 第二堂團契:爸媽不在家，我要活下去~製作豚汁定食)',
  responses: [
    { name: '林光佑', dates: ['9/27（六）'] },
    { name: '陳小華 ', dates: ['9/27（六）', '10/4（六）'] },
    { name: '王美美', dates: ['9/27（六）'] },
    { name: '李大同', dates: ['10/4（六）'] },
    { name: '路人甲', dates: ['9/27（六）'] },
    { name: '陳小華', dates: ['9/27（六）'] },
  ],
};

describe('friends who signed up for the next gathering', () => {
  it('refuses a push without the key and keeps nothing', async () => {
    const { push, database } = setup();
    expect((await push(FORM, 'wrong')).status).toBe(401);
    expect(database.db.prepare('SELECT count(*) AS n FROM event_registrations').get()).toEqual({ n: 0 });
  });

  it('keeps matched members and a head count per date, never the names it could not match', async () => {
    const { push, database } = setup();
    const response = await push(FORM);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, events: [{ date: '2026-09-27', total: 4, matched: 3 }, { date: '2026-10-04', total: 2, matched: 2 }] });
    const stored = JSON.stringify(database.db.prepare('SELECT * FROM event_registrations').all());
    expect(stored).not.toContain('路人甲');
    expect(stored).not.toContain('王美美');
    expect(stored).toContain('member-stranger');
  });

  it('shows a member the head count, whether they signed up, and only their friends by name', async () => {
    const { push, api, member } = setup();
    await push(FORM);
    const self = await api({ method: 'GET', url: '/api/me/event-registrations?date=2026-09-27', headers: member('member-self') });
    expect(self.status).toBe(200);
    expect(self.body).toEqual({ date: '2026-09-27', total: 4, registered: true, friends: ['陳小華'] });
    const later = await api({ method: 'GET', url: '/api/me/event-registrations?date=2026-10-04', headers: member('member-self') });
    expect(later.body).toEqual({ date: '2026-10-04', total: 2, registered: false, friends: ['大同', '陳小華'] });
    const stranger = await api({ method: 'GET', url: '/api/me/event-registrations?date=2026-09-27', headers: member('member-stranger') });
    expect(stranger.body).toEqual({ date: '2026-09-27', total: 4, registered: true, friends: [] });
    const none = await api({ method: 'GET', url: '/api/me/event-registrations?date=2026-11-01', headers: member('member-self') });
    expect(none.body).toEqual({ date: '2026-11-01', total: 0, registered: false, friends: [] });
  });

  it('replaces a date on every push, so a cancelled sign-up disappears', async () => {
    const { push, api, member } = setup();
    await push(FORM);
    await push({ ...FORM, responses: FORM.responses.filter((row) => !row.name.startsWith('陳小華')) });
    const self = await api({ method: 'GET', url: '/api/me/event-registrations?date=2026-09-27', headers: member('member-self') });
    expect(self.body).toMatchObject({ total: 3, friends: [] });
  });

  it('matches a short member name only when exactly one member fits', async () => {
    const { database, api, member } = setup();
    database.db.prepare("INSERT INTO members(id, display_name, group_id) VALUES('member-other-guangyou', '光佑', 'g1')").run();
    const push = (body: unknown) => api({ method: 'POST', url: '/api/integrations/form-registrations', headers: { 'x-qingmu-registration-key': KEY }, body: JSON.stringify(body) });
    await push({ formTitle: 'x', responses: [{ name: '林光佑', dates: ['9/27'] }] });
    const self = await api({ method: 'GET', url: '/api/me/event-registrations?date=2026-09-27', headers: member('member-self') });
    expect(self.body).toMatchObject({ total: 1, registered: false });
  });

  it('derives the push key from the session secret so no new secret has to be configured', () => {
    expect(deriveFormRegistrationKey('secret-a')).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveFormRegistrationKey('secret-a')).not.toBe(deriveFormRegistrationKey('secret-b'));
  });
});
