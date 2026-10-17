import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createDeviceSession } from '../../server/mobileSessions';
import { createSessionToken } from '../../server/session';

describe('Apple sessions and permanent account deletion', () => {
  it('provisions an Apple member once and issues an ordinary device session', async () => {
    const db = createDatabase();
    try {
      const api = createApiHandler({ db, sessionSecret: 'test-secret', productionGoogleAuth: {
        verify: async () => { throw new Error('not Google'); }, resolveMember: async () => null,
      }, productionAppleAuth: { verify: async () => ({ provider: 'apple', subject: 'apple-sub' }) } } as Parameters<typeof createApiHandler>[0]);
      const challenge = async () => String((await api({ method: 'POST', url: '/api/session/apple/challenge', headers: {} })).body.nonce);
      const request = async () => api({ method: 'POST', url: '/api/session/apple', headers: { authorization: 'Bearer apple-token' }, body: JSON.stringify({ nonce: await challenge() }) });
      const first = await request();
      expect(first.status).toBe(200);
      expect(first.body.sessionKind).toBe('device');
      const again = await request();
      expect(again.body.memberId).toBe(first.body.memberId);
      expect(db.db.prepare("SELECT count(*) AS n FROM identity_bindings WHERE provider='apple'").get()?.n).toBe(1);
      expect((await api({ method: 'GET', url: '/api/me/profile', headers: { authorization: `Bearer ${first.body.sessionToken}` } })).status).toBe(200);
    } finally { db.close(); }
  });

  it('deletes only the authenticated member, invalidates old sessions, and preserves the other member', async () => {
    const db = createDatabase({ members: [{ id: 'self', displayName: '虛構甲', groupId: 'youth' }, { id: 'other', displayName: '虛構乙', groupId: 'main' }] });
    try {
      const api = createApiHandler({ db, sessionSecret: 'test-secret', productionGoogleAuth: {
        verify: async () => { throw new Error('invalid'); }, resolveMember: async () => null,
      } });
      for (const id of ['self', 'other']) {
        db.db.prepare('INSERT INTO identity_bindings VALUES(?,?,?,?)').run('google', `sub-${id}`, id, '2026-10-17');
        db.db.prepare('INSERT INTO completions VALUES(?,?,?,?,?,?,?)').run(id, 'plan', '2026-10-17', 'COMPLETED', 1, 'CONFIRMED', `op-${id}`);
        db.db.prepare('INSERT INTO devotion_completions VALUES(?,?,?)').run(id, '2026-10-17', 1);
        db.db.prepare('INSERT INTO journal_entries VALUES(?,?,?,?,?,?,?,?)').run(id, '2026-10-17', 'plan', `private-${id}`, 1, 1, 1, null);
        db.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(`op-${id}`, JSON.stringify({ memberId: id, private: id }), JSON.stringify([id, 'plan']));
      }
      db.db.prepare('INSERT INTO friendships VALUES(?,?,?,?,?)').run('other', 'self', 1, 'self', 'friend-op');
      const token = createDeviceSession(db.db, 'self').sessionToken;
      const legacy = createSessionToken('self', 'test-secret');
      const before = db.db.prepare("SELECT * FROM members WHERE id='other'").get();
      expect((await api({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${token}`, 'x-qingmu-member-id': 'other' }, body: '{"confirmed":true,"memberId":"other"}' })).status).toBe(200);
      for (const table of ['members', 'identity_bindings', 'completions', 'devotion_completions', 'journal_entries', 'auth_sessions']) {
        const column = table === 'members' ? 'id' : 'member_id';
        expect(db.db.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).all('self'), table).toEqual([]);
      }
      expect(db.db.prepare("SELECT * FROM operations WHERE operation_id='op-self'").get()).toBeUndefined();
      expect(db.db.prepare('SELECT * FROM friendships').all()).toEqual([]);
      expect(db.db.prepare("SELECT * FROM members WHERE id='other'").get()).toEqual(before);
      expect(db.db.prepare("SELECT * FROM completions WHERE member_id='other'").all()).toHaveLength(1);
      expect(db.db.prepare("SELECT * FROM operations WHERE operation_id='op-other'").get()).toBeDefined();
      for (const old of [token, legacy]) expect((await api({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${old}` } })).status).toBe(401);
    } finally { db.close(); }
  });

  it('requires an authenticated session and explicit confirmation', async () => {
    const db = createDatabase({ members: [{ id: 'self', displayName: '虛構甲', groupId: 'youth' }] });
    try {
      const api = createApiHandler({ db, fixtureToken: 'fixture' });
      expect((await api({ method: 'DELETE', url: '/api/me', headers: {}, body: '{"confirmed":true}' })).status).toBe(401);
      expect((await api({ method: 'DELETE', url: '/api/me', headers: { authorization: 'Bearer fixture', 'x-qingmu-member-id': 'self' }, body: '{}' })).status).toBe(400);
      expect(db.db.prepare("SELECT * FROM members WHERE id='self'").get()).toBeDefined();
    } finally { db.close(); }
  });
});
