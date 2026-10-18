import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createDeviceSession } from '../../server/mobileSessions';
import { sealAppleToken } from '../../server/appleTokens';

const setup = () => {
  const db = createDatabase({ members: ['delete-me', 'keep-me'].map(id => ({ id, displayName: `private-${id}`, groupId: 'youth' })) });
  const revoked: string[] = [];
  const api = createApiHandler({ db, sessionSecret: 'secret', productionGoogleAuth: { verify: async () => { throw Error('invalid'); }, resolveMember: async () => null },
    productionAppleAuth: { verify: async () => { throw Error('invalid'); }, revoke: async token => { revoked.push(token); } } });
  // Prize nominations were removed on 2026-10-17, but databases from before still hold these tables and the
  // members' rows in them; deleting an account must clear those too.
  db.db.exec(`CREATE TABLE reward_nominations(nomination_id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT, created_by TEXT NOT NULL,
      status TEXT NOT NULL, reward_id TEXT, decided_by TEXT, decided_at INTEGER, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE reward_nomination_votes(nomination_id TEXT NOT NULL, member_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (nomination_id, member_id));
    CREATE TABLE reward_nomination_rounds(round_id TEXT PRIMARY KEY, title TEXT, opened_by TEXT NOT NULL, opened_at INTEGER NOT NULL, closes_at INTEGER NOT NULL, closed_at INTEGER, state TEXT NOT NULL);
    CREATE TABLE reward_nomination_assists(nomination_id TEXT PRIMARY KEY, estimated_twd INTEGER, note_suggestion TEXT, state TEXT NOT NULL, failure TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, requested_at INTEGER NOT NULL, completed_at INTEGER);`);
  for (const id of ['delete-me', 'keep-me']) {
    const sql = (text: string, ...args: (string | number | null)[]) => db.db.prepare(text).run(...args);
    sql('INSERT INTO identity_bindings VALUES(?,?,?,?)', 'apple', `subject-${id}`, id, 'now');
    sql('INSERT INTO apple_refresh_tokens VALUES(?,?)', id, sealAppleToken(`refresh-${id}`, 'secret'));
    sql('INSERT INTO member_invites VALUES(?,?,?,?,?,?,?,?)', id, `hash-${id}`, id, `private-${id}`, 'G', 'future', null, 'now');
    sql('INSERT OR REPLACE INTO member_affiliations(member_id, congregation) VALUES(?,?)', id, 'youth');
    sql('INSERT INTO member_group_profiles(member_id,group_id,group_name,rpg_id,rpg_name,link_status,link_revision,updated_at) VALUES(?,?,?,?,?,?,?,?)', id, 'G', 'group', 'rpg', 'rpg', 'READY', 1, 'now');
    sql('INSERT INTO reminder_preferences(member_id,updated_at) VALUES(?,?)', id, 'now');
    sql('INSERT INTO device_delivery_tokens(installation_id,member_id,platform,token,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, id, 'ios', `push-${id}`, 'now', 'now');
    sql('INSERT INTO reminder_deliveries(delivery_id,reminder_id,member_id,meeting_id,schedule_revision,trigger_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?)', id, 'reminder', id, 'meeting', 1, 'now', 'future', 'PENDING');
    sql('INSERT INTO completions VALUES(?,?,?,?,?,?,?)', id, 'p', '2026-10-17', 'COMPLETED', 1, 'CONFIRMED', id);
    sql('INSERT INTO point_events VALUES(?,?,?,?,?)', id, id, `${id}:p`, 'COMPLETED', 'p');
    sql('INSERT INTO devotion_completions VALUES(?,?,?)', id, '2026-10-17', 1);
    sql('INSERT INTO journal_entries VALUES(?,?,?,?,?,?,?,?)', id, '2026-10-17', 'p', `private-${id}`, 1, 1, 1, null);
    sql('INSERT INTO daily_point_entitlements VALUES(?,?,?,?,?,?,?,?,?,?)', id, '2026-10-17', 'p', 1, 1, 1, 'p', 1, 1, null);
    sql('INSERT INTO wallet_entries(entry_id,member_id,kind,delta,created_at) VALUES(?,?,?,?,?)', id, id, 'READING_CREDIT', 1, 1);
    sql('INSERT INTO reward_targets VALUES(?,?,?)', id, 'reward', 1);
    sql('INSERT INTO redemptions(redemption_id,member_id,reward_id,reward_name_snapshot,cost_points_snapshot,reward_revision,status,confirmed_by,confirmed_at,operation_id) VALUES(?,?,?,?,?,?,?,?,?,?)', id, id, 'reward', 'public reward', 1, 1, 'COMPLETED', id, 1, id);
    sql('INSERT INTO friend_tokens VALUES(?,?,?,?,?)', id, id, 1, 2, null);
    sql('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?,?,?)', id, id, 'test', 'digest', 'test', id, JSON.stringify({ memberId: id }), 1);
    sql('INSERT INTO operations VALUES(?,?,?)', id, JSON.stringify({ memberId: id }), JSON.stringify([id]));
    sql('INSERT INTO event_registrations VALUES(?,?,?)', '2026-10-17', id, 'now');
    sql('INSERT INTO reward_nominations(nomination_id,name,created_by,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', id, `private-${id}`, id, 'OPEN', 1, 1, 1);
    sql('INSERT INTO reward_nomination_votes VALUES(?,?,?)', id, id, 1);
    sql('INSERT INTO reward_nomination_assists(nomination_id,state,attempts,requested_at,note_suggestion) VALUES(?,?,?,?,?)', id, 'DONE', 1, 1, `private-${id}`);
    createDeviceSession(db.db, id);
  }
  const token = createDeviceSession(db.db, 'delete-me').sessionToken;
  return { db, api, revoked, request: { method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${token}` }, body: '{"confirmed":true}' } };
};
describe('complete server account deletion', () => {
  it('removes all owned data, credentials, affiliation, legacy content and cached responses while preserving the other account', async () => {
    const { db, api, revoked, request } = setup();
    try {
      expect((await api(request)).status).toBe(200);
      expect(revoked).toEqual(['refresh-delete-me']);
      const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      for (const { name } of tables) {
        const contents = JSON.stringify(db.db.prepare(`SELECT * FROM "${name}"`).all());
        expect(contents, name).not.toContain('delete-me');
      }
      for (const table of ['members', 'completions', 'wallet_entries', 'redemptions', 'member_affiliations', 'reward_nominations', 'reward_nomination_assists']) {
        expect(JSON.stringify(db.db.prepare(`SELECT * FROM "${table}"`).all()), table).toContain('keep-me');
      }
    } finally { db.close(); }
  });
  it('rolls back every local change on a database failure', async () => {
    const { db, api, request } = setup();
    try {
      const before = db.db.prepare('SELECT * FROM identity_bindings ORDER BY subject').all();
      db.db.exec("CREATE TRIGGER refuse_delete BEFORE DELETE ON members BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
      expect((await api(request)).status).toBe(500);
      expect(db.db.prepare('SELECT * FROM identity_bindings ORDER BY subject').all()).toEqual(before);
      expect(db.db.prepare("SELECT * FROM journal_entries WHERE member_id='delete-me'").get()).toBeDefined();
    } finally { db.close(); }
  });
});
