import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

describe('Google identity first-login provisioning', () => {
  it('creates one member and binding in the same login transaction, then reuses its member id', async () => {
    const database = createDatabase();
    const api = createApiHandler({
      db: database,
      sessionSecret: 'test-secret',
      autoProvisionGoogleMembers: true,
      productionGoogleAuth: {
        verify: async () => ({ provider: 'google' as const, subject: 'new-subject', displayName: '新會員' }),
        resolveMember: async () => null,
      },
    });
    const login = () => api({ method: 'POST', url: '/api/session/google', headers: { authorization: 'Bearer google-id-token' }, body: JSON.stringify({ session_type: 'device' }) });
    const first = await login();
    const second = await login();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.memberId).toBe(second.body.memberId);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM members').get()).toEqual({ count: 1 });
    expect(database.db.prepare('SELECT provider,subject,member_id FROM identity_bindings').get()).toEqual({ provider: 'google', subject: 'new-subject', member_id: first.body.memberId });
    const profile = await api({ method: 'GET', url: '/api/me/profile', headers: { authorization: `Bearer ${String(first.body.sessionToken)}` } });
    expect(profile.body).toMatchObject({ memberId: first.body.memberId, displayName: '新會員' });
    database.close();
  });

  it('does not make a disabled existing identity into a new member', async () => {
    const database = createDatabase({ members: [{ id: 'existing-member', displayName: '停用者', groupId: 'unassigned:existing-member' }] });
    database.db.prepare('UPDATE members SET disabled_at=? WHERE id=?').run(Date.now(), 'existing-member');
    database.db.prepare('INSERT INTO identity_bindings(provider,subject,member_id,created_at) VALUES(?,?,?,?)').run('google', 'disabled-subject', 'existing-member', Date.now());
    const api = createApiHandler({ db: database, sessionSecret: 'test-secret', autoProvisionGoogleMembers: true, productionGoogleAuth: { verify: async () => ({ provider: 'google' as const, subject: 'disabled-subject', displayName: '新名' }), resolveMember: async () => null } });
    const response = await api({ method: 'POST', url: '/api/session/google', headers: { authorization: 'Bearer token' }, body: '{}' });
    expect(response).toMatchObject({ status: 403, body: { error: 'ACCOUNT_DISABLED' } });
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM members').get()).toEqual({ count: 1 });
    database.close();
  });
});
