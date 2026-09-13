import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

function hashInvite(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

describe('Google identity onboarding', () => {
  it('rejects an unassigned Google subject, then binds it once through an expiring invite', async () => {
    const database = createDatabase();
    database.db.exec(`
      CREATE TABLE IF NOT EXISTS member_invites (
        invite_id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        member_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        group_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
    database.db.prepare(
      'INSERT INTO member_invites (invite_id, code_hash, member_id, display_name, group_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('invite-1', hashInvite('one-time-code'), 'google:subject-1', '測試成員甲', 'G01', '2099-01-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z');
    const api = createApiHandler({
      db: database,
      sessionSecret: 'test-session-secret',
      productionGoogleAuth: {
        verify: async (idToken) => {
          expect(idToken).toBe('google-id-token');
          return { provider: 'google', subject: 'subject-1' };
        },
        resolveMember: async () => null,
      },
    });
    const idHeaders = { authorization: 'Bearer google-id-token' };

    await expect(api({ method: 'GET', url: '/api/progress?date=2026-09-08', headers: idHeaders })).resolves.toMatchObject({
      status: 403,
      body: { error: 'UNKNOWN_MEMBER' },
    });

    const claim = await api({
      method: 'POST',
      url: '/api/onboarding/claim',
      headers: idHeaders,
      body: JSON.stringify({ invite_code: 'one-time-code' }),
    });
    expect(claim).toMatchObject({ status: 200, body: { memberId: 'google:subject-1' } });
    expect(typeof claim.body.sessionToken).toBe('string');

    const sessionHeaders = { authorization: `Bearer ${String(claim.body.sessionToken)}` };
    await expect(api({ method: 'GET', url: '/api/progress?date=2026-09-08', headers: sessionHeaders })).resolves.toMatchObject({
      status: 200,
      body: { personal: { status: 'UNREPORTED' } },
    });
    expect(database.db.prepare('SELECT member_id FROM identity_bindings').get()).toEqual({ member_id: 'google:subject-1' });
    expect(database.db.prepare('SELECT used_at FROM member_invites WHERE invite_id = ?').get('invite-1')).toMatchObject({ used_at: expect.any(String) });
    database.close();
  });

  it('does not accept expired or already-used invites for another subject', async () => {
    const database = createDatabase();
    database.db.prepare(
      'INSERT INTO member_invites (invite_id, code_hash, member_id, display_name, group_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('invite-2', hashInvite('single-use'), 'member:one', '測試成員乙', 'G01', '2099-01-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z');
    database.db.prepare(
      'INSERT INTO member_invites (invite_id, code_hash, member_id, display_name, group_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('invite-expired', hashInvite('expired'), 'member:expired', '已過期', 'G01', '2020-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z');
    let subject = 'subject-one';
    const api = createApiHandler({
      db: database,
      sessionSecret: 'test-session-secret',
      productionGoogleAuth: {
        verify: async () => ({ provider: 'google' as const, subject }),
        resolveMember: async () => null,
      },
    });
    const headers = { authorization: 'Bearer google-id-token' };
    await expect(api({ method: 'POST', url: '/api/onboarding/claim', headers, body: JSON.stringify({ invite_code: 'expired' }) })).resolves.toMatchObject({ status: 403, body: { error: 'INVITE_EXPIRED' } });
    await expect(api({ method: 'POST', url: '/api/onboarding/claim', headers, body: JSON.stringify({ invite_code: 'single-use' }) })).resolves.toMatchObject({ status: 200 });
    subject = 'subject-two';
    await expect(api({ method: 'POST', url: '/api/onboarding/claim', headers, body: JSON.stringify({ invite_code: 'single-use' }) })).resolves.toMatchObject({ status: 403, body: { error: 'INVITE_USED' } });
    database.close();
  });
});
