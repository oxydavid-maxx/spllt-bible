import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

function fixture(resolveMember: () => Promise<string | null> = async () => null) {
  const database = createDatabase();
  const api = createApiHandler({ db: database, sessionSecret: 'test-secret', autoProvisionGoogleMembers: true,
    productionGoogleAuth: { verify: async () => ({ provider: 'google' as const, subject: 'synthetic-subject' }), resolveMember } });
  const login = (signal: unknown, address = '192.0.2.10') => api({ method: 'POST', url: '/api/session/google',
    headers: { authorization: 'Bearer synthetic-token', 'cf-connecting-ip': address },
    body: JSON.stringify({ session_type: 'device', ...(signal === undefined ? {} : { firebase_test_lab: signal }) }) });
  return { database, api, login };
}

describe('Test Lab system signal at Google provisioning boundary', () => {
  it('creates a disabled member when the signal is true even outside the IP list; never issues a session', async () => {
    const { database, login } = fixture();
    try {
      expect(await login(true)).toMatchObject({ status: 403, body: { error: 'ACCOUNT_DISABLED' } });
      expect(await login(false)).toMatchObject({ status: 403, body: { error: 'ACCOUNT_DISABLED' } });
      expect(database.db.prepare('SELECT disabled_at FROM members').get()).toEqual({ disabled_at: expect.any(Number) });
      expect(database.db.prepare('SELECT COUNT(*) AS count FROM members').get()).toEqual({ count: 1 });
      expect(database.db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()).toEqual({ count: 0 });
    } finally { database.close(); }
  });

  it.each([undefined, false, 'true', 1, null])('keeps ordinary new members enabled for signal %s', async (signal) => {
    const { database, login } = fixture();
    try {
      expect(await login(signal)).toMatchObject({ status: 200 });
      expect(database.db.prepare('SELECT disabled_at FROM members').get()).toEqual({ disabled_at: null });
    } finally { database.close(); }
  });

  it.each([undefined, false, true])('preserves the IP fallback for signal %s', async (signal) => {
    const { database, login } = fixture();
    try { expect(await login(signal, '108.177.6.20')).toMatchObject({ status: 403, body: { error: 'ACCOUNT_DISABLED' } }); }
    finally { database.close(); }
  });

  it.each(['binding', 'resolver'])('never disables an existing enabled member found by %s', async (source) => {
    const { database, login } = fixture(async () => source === 'resolver' ? 'existing' : null);
    try {
      database.db.prepare('INSERT INTO members(id,display_name,group_id) VALUES(?,?,?)').run('existing', 'Synthetic member', 'unassigned:existing');
      if (source === 'binding') database.db.prepare('INSERT INTO identity_bindings(provider,subject,member_id,created_at) VALUES(?,?,?,?)').run('google', 'synthetic-subject', 'existing', 1);
      expect(await login(true, '108.177.6.20')).toMatchObject({ status: 200, body: { memberId: 'existing' } });
      expect(database.db.prepare('SELECT disabled_at FROM members').get()).toEqual({ disabled_at: null });
    } finally { database.close(); }
  });

  it('rejects malformed signal JSON before creating any member', async () => {
    const { database, api } = fixture();
    try {
      expect(await api({ method: 'POST', url: '/api/session/google', headers: { authorization: 'Bearer synthetic-token' }, body: '{' })).toMatchObject({ status: 400, body: { error: 'INVALID_JSON' } });
      expect(database.db.prepare('SELECT COUNT(*) AS count FROM members').get()).toEqual({ count: 0 });
    } finally { database.close(); }
  });
});
