import { describe, expect, it } from 'vitest';
import { authenticateGoogle } from '../../server/authBoundary';

describe('production Google session boundary', () => {
  it('does not trust a client supplied member id and binds a verified subject through the resolver', async () => {
    const result = await authenticateGoogle(
      {
        authorization: 'Bearer verified-id-token',
        'x-qingmu-member-id': 'fixture:other',
      },
      {
        verify: async (token) => {
          expect(token).toBe('verified-id-token');
          return { provider: 'google', subject: 'google-sub-1' };
        },
        resolveMember: async (identity) => identity.subject === 'google-sub-1' ? 'google:google-sub-1' : null,
      },
    );
    expect(result).toEqual({ memberId: 'google:google-sub-1', mode: 'google-session' });
  });

  it('rejects invalid tokens and unbound subjects', async () => {
    await expect(authenticateGoogle({}, { verify: async () => { throw new Error('invalid'); }, resolveMember: async () => null })).resolves.toMatchObject({ status: 401, error: 'AUTH_REQUIRED' });
    await expect(authenticateGoogle({ authorization: 'Bearer bad' }, { verify: async () => { throw new Error('invalid'); }, resolveMember: async () => null })).resolves.toMatchObject({ status: 401, error: 'AUTH_INVALID' });
    await expect(authenticateGoogle({ authorization: 'Bearer valid' }, { verify: async () => ({ provider: 'google', subject: 'new-sub' }), resolveMember: async () => null })).resolves.toMatchObject({ status: 403, error: 'UNKNOWN_MEMBER' });
  });
});
