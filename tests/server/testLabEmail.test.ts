import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

function fixture(email?: string, existing?: 'binding' | 'resolver') {
  const database = createDatabase();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const api = createApiHandler({
    db: database,
    sessionSecret: 'test-secret',
    autoProvisionGoogleMembers: true,
    productionGoogleAuth: {
      verify: async () => ({ provider: 'google' as const, subject: 'synthetic-subject', email, displayName: 'Synthetic private name' }),
      resolveMember: async () => existing === 'resolver' ? 'existing' : null,
    },
  });
  if (existing) {
    database.db.prepare('INSERT INTO members(id,display_name,group_id) VALUES(?,?,?)').run('existing', 'Existing member', 'unassigned:existing');
    if (existing === 'binding') database.db.prepare('INSERT INTO identity_bindings(provider,subject,member_id,created_at) VALUES(?,?,?,?)').run('google', 'synthetic-subject', 'existing', 1);
  }
  const login = (body: Record<string, unknown> = {}, address?: string) => api({
    method: 'POST', url: '/api/session/google',
    headers: { authorization: 'Bearer synthetic-token', ...(address ? { 'cf-connecting-ip': address } : {}) },
    body: JSON.stringify({ session_type: 'device', ...body }),
  });
  return { database, login, log };
}

afterEach(() => vi.restoreAllMocks());

describe('Verified Google email at the first-login Test Lab boundary', () => {
  it.each(['x@cloudtestlabaccounts.com', 'X@CloudTestLabAccounts.COM'])('creates %s disabled without a client flag or listed IP', async (email) => {
    const { database, login } = fixture(email);
    try {
      expect(await login()).toMatchObject({ status: 403, body: { error: 'ACCOUNT_DISABLED' } });
      expect(database.db.prepare('SELECT disabled_at FROM members').get()).toEqual({ disabled_at: expect.any(Number) });
      expect(database.db.prepare('SELECT provider,subject FROM identity_bindings').get()).toEqual({ provider: 'google', subject: 'synthetic-subject' });
      expect(await login()).toMatchObject({ status: 403, body: { error: 'ACCOUNT_DISABLED' } });
      expect(database.db.prepare('SELECT COUNT(*) AS count FROM members').get()).toEqual({ count: 1 });
      expect(database.db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()).toEqual({ count: 0 });
    } finally { database.close(); }
  });

  it.each(['person@gmail.com', undefined, 'x@cloudtestlabaccounts.com.evil.example', 'x@notcloudtestlabaccounts.com'])('keeps %s enabled', async (email) => {
    const { database, login } = fixture(email);
    try {
      expect(await login()).toMatchObject({ status: 200 });
      expect(database.db.prepare('SELECT disabled_at FROM members').get()).toEqual({ disabled_at: null });
    } finally { database.close(); }
  });

  it.each(['person@gmail.com', undefined])('ignores a request-body Test Lab email when verified email is %s', async (email) => {
    const { database, login } = fixture(email);
    try {
      expect(await login({ email: 'forged@cloudtestlabaccounts.com' })).toMatchObject({ status: 200 });
      expect(database.db.prepare('SELECT disabled_at FROM members').get()).toEqual({ disabled_at: null });
    } finally { database.close(); }
  });

  it.each(['binding', 'resolver'] as const)('does not disable or provision an existing member found by %s', async (existing) => {
    const { database, login, log } = fixture('x@cloudtestlabaccounts.com', existing);
    try {
      expect(await login({ firebase_test_lab: true }, '108.177.6.20')).toMatchObject({ status: 200, body: { memberId: 'existing' } });
      expect(database.db.prepare('SELECT disabled_at FROM members').get()).toEqual({ disabled_at: null });
      expect(database.db.prepare('SELECT COUNT(*) AS count FROM members').get()).toEqual({ count: 1 });
      expect(log).not.toHaveBeenCalled();
    } finally { database.close(); }
  });

  it.each([
    { body: {}, email: undefined, address: undefined, fields: 'testDevice=false clientFlag=absent emailClaim=missing testLabEmailDomain=false testLabAddress=false clientAddress=missing' },
    { body: { firebase_test_lab: true }, email: 'person@gmail.com', address: '192.0.2.10', fields: 'testDevice=true clientFlag=true emailClaim=present testLabEmailDomain=false testLabAddress=false clientAddress=present' },
    { body: { firebase_test_lab: false }, email: 'X@CloudTestLabAccounts.COM', address: '192.0.2.10', fields: 'testDevice=true clientFlag=false emailClaim=present testLabEmailDomain=true testLabAddress=false clientAddress=present' },
    { body: { firebase_test_lab: false }, email: undefined, address: '108.177.6.20', fields: 'testDevice=true clientFlag=false emailClaim=missing testLabEmailDomain=false testLabAddress=true clientAddress=present' },
    ...['true', 1, null, {}, []].map((signal) => ({ body: { firebase_test_lab: signal }, email: 'person@gmail.com', address: undefined, fields: 'testDevice=false clientFlag=other emailClaim=present testLabEmailDomain=false testLabAddress=false clientAddress=missing' })),
    { body: { firebase_test_lab: true }, email: 'x@cloudtestlabaccounts.com', address: '108.177.6.20', fields: 'testDevice=true clientFlag=true emailClaim=present testLabEmailDomain=true testLabAddress=true clientAddress=present' },
  ])('logs only the individual signal states: $fields', async ({ body, email, address, fields }) => {
    const { database, login, log } = fixture(email);
    try {
      const response = await login(body, address);
      expect(response.status).toBe(fields.startsWith('testDevice=true ') ? 403 : 200);
      expect(log.mock.calls).toEqual([[`AUTO_PROVISION_MEMBER ${fields}`]]);
      const output = JSON.stringify(log.mock.calls);
      for (const privateValue of [email, address, 'Synthetic private name', 'synthetic-subject', 'synthetic-token']) {
        if (privateValue) expect(output).not.toContain(privateValue);
      }
    } finally { database.close(); }
  });
});
