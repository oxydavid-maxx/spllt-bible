import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

describe('authenticated fixed group/RPG profile', () => {
  it('returns only the signed-in member\'s approved group and RPG entry', async () => {
    const database = createDatabase({
      members: [
        { id: 'google:self', displayName: '測試成員甲', groupId: 'G01' },
        { id: 'google:other', displayName: '測試成員乙', groupId: 'G02' },
      ],
    });
    database.db.exec(`
      CREATE TABLE IF NOT EXISTS member_group_profiles (
        member_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        rpg_id TEXT NOT NULL,
        rpg_name TEXT NOT NULL,
        open_chat_url TEXT,
        call_url TEXT,
        call_provider TEXT,
        call_scope TEXT,
        link_status TEXT NOT NULL,
        link_revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (member_id, rpg_id)
      );
    `);
    database.db.prepare(
      `INSERT INTO member_group_profiles
        (member_id, group_id, group_name, rpg_id, rpg_name, open_chat_url, call_url, call_provider, call_scope, link_status, link_revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('google:self', 'G01', 'A小組', 'G01-RPG1', 'A-RPG1', null, 'https://meet.google.com/pilot-test', 'meet', 'TEST_ONLY', 'READY', 1, '2026-09-08T00:00:00.000Z');
    const api = createApiHandler({ db: database, fixtureToken: 'fixture-token' });
    const response = await api({ method: 'GET', url: '/api/me/groups', headers: { authorization: 'Bearer fixture-token', 'x-qingmu-member-id': 'google:self' } });

    expect(response).toMatchObject({
      status: 200,
      body: {
        groupId: 'G01',
        groupName: 'A小組',
        rpgs: [{ rpgId: 'G01-RPG1', rpgName: 'A-RPG1', openChatUrl: null, callUrl: null, callProvider: null, callScope: null, linkStatus: 'READY', linkRevision: 1, meeting: null, roster: null }],
      },
    });
    database.close();
  });
});
