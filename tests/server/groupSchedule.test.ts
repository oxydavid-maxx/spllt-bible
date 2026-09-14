import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

describe('member RPG meeting context', () => {
  it('keeps the retired group response shape without social, meeting, or roster data', async () => {
    const database = createDatabase({ members: [{ id: 'member:one', displayName: '小明', groupId: 'G01' }, { id: 'member:two', displayName: '同工乙', groupId: 'G01' }] });
    database.db.prepare(`INSERT INTO member_group_profiles (member_id, group_id, group_name, rpg_id, rpg_name, open_chat_url, call_url, call_provider, call_scope, link_status, link_revision, updated_at, meeting_id, meeting_title, starts_at, ends_at, time_zone, organizer_label, schedule_revision, schedule_status, standing_room, last_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('member:one', 'G01', 'A小組', 'G01-RPG1', 'A-RPG1', 'https://line.me/ti/g2/test', 'https://meet.google.com/test', 'meet', 'APPROVED', 'READY', 2, '2026-09-09T00:00:00Z', 'm1', '本週RPG', '2026-09-12T19:00:00+08:00', '2026-09-12T20:00:00+08:00', 'Asia/Taipei', '帶領者', 3, 'SCHEDULED', 1, '2026-09-09T00:00:00Z');
    const api = createApiHandler({ db: database, fixtureToken: 'fixture-token' });
    const response = await api({ method: 'GET', url: '/api/me/groups', headers: { authorization: 'Bearer fixture-token', 'x-qingmu-member-id': 'member:one' } });
    expect(response).toMatchObject({ status: 200, body: { groupId: 'G01', rpgs: [{ rpgId: 'G01-RPG1', meeting: null, roster: null, openChatUrl: null, callUrl: null, standingRoom: true }] } });
    database.close();
  });
});
