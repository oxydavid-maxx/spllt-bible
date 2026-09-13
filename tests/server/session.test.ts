import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createSessionToken, verifySessionToken } from '../../server/session';

describe('Google session exchange', () => {
  it('signs and verifies a short-lived server session', () => {
    const token = createSessionToken('google:sub-1', 'test-secret', 100, 60);
    expect(verifySessionToken(token, 'test-secret', 120)).toBe('google:sub-1');
    expect(verifySessionToken(token, 'wrong-secret', 120)).toBeNull();
    expect(verifySessionToken(token, 'test-secret', 161)).toBeNull();
  });

  it('exchanges a verified Google token and accepts the resulting session without trusting a client member id', async () => {
    const db = createDatabase({ members: [{ id: 'google:sub-1', displayName: '小明', groupId: 'G01' }] });
    const api = createApiHandler({
      db,
      sessionSecret: 'test-secret',
      productionGoogleAuth: {
        verify: async (token) => {
          if (token !== 'google-id-token') throw new Error('invalid');
          return { provider: 'google', subject: 'sub-1' };
        },
        resolveMember: async (identity) => identity.subject === 'sub-1' ? 'google:sub-1' : null,
      },
    });
    const exchanged = await api({ method: 'POST', url: '/api/session/google', headers: { authorization: 'Bearer google-id-token' }, body: '{}' });
    expect(exchanged.status).toBe(200);
    const sessionToken = String(exchanged.body.sessionToken);
    const progress = await api({
      method: 'GET',
      url: '/api/progress?date=2026-09-08',
      headers: { authorization: `Bearer ${sessionToken}`, 'x-qingmu-member-id': 'google:other' },
    });
    expect(progress.status).toBe(200);
    expect(progress.body.members).toEqual([{ id: 'google:sub-1', label: '小明', isSelf: true, status: 'UNREPORTED' }]);
    db.close();
  });
});
