import { describe, expect, it } from 'vitest';
import { authenticate, authenticateGoogle } from '../../server/authBoundary';

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

describe('development fixture boundary', () => {
  const exists = (id: string) => id === 'fixture:self' || id === 'fixture:other';
  it('names the member by header, as before', () => {
    expect(authenticate({ authorization: 'Bearer t', 'x-qingmu-member-id': 'fixture:other' }, 't', exists)).toEqual({ memberId: 'fixture:other', mode: 'development-fixture' });
    expect(authenticate({ authorization: 'Bearer t' }, 't', exists)).toEqual({ status: 403, error: 'UNKNOWN_MEMBER' });
  });
  it('falls back to a configured default member when a client sends the token alone (the CI simulator fixture)', () => {
    // The points / nominations client sends only the bearer token, as a production session does.
    expect(authenticate({ authorization: 'Bearer t' }, 't', exists, 'fixture:self')).toEqual({ memberId: 'fixture:self', mode: 'development-fixture' });
    expect(authenticate({ authorization: 'Bearer t', 'x-qingmu-member-id': 'fixture:other' }, 't', exists, 'fixture:self')).toEqual({ memberId: 'fixture:other', mode: 'development-fixture' });
    expect(authenticate({ authorization: 'Bearer wrong' }, 't', exists, 'fixture:self')).toEqual({ status: 401, error: 'AUTH_REQUIRED' });
  });
});
