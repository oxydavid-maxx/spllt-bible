import { describe, expect, it } from 'vitest';
import { validateGoogleClaims } from '../../server/googleVerifier';

describe('Google token verification boundary', () => {
  const base = {
    iss: 'https://accounts.google.com',
    aud: 'server-client.apps.googleusercontent.com',
    sub: 'google-sub-1',
    exp: 2_000,
  };

  it('accepts the expected issuer/audience and returns a provider subject', () => {
    expect(validateGoogleClaims(base, { audience: base.aud, nowSeconds: 1_000 })).toMatchObject({
      provider: 'google',
      subject: 'google-sub-1',
    });
  });

  it.each([
    ['issuer', { iss: 'https://evil.example' }, 'GOOGLE_ISSUER_INVALID'],
    ['audience', { aud: 'other-client' }, 'GOOGLE_AUDIENCE_INVALID'],
    ['expiry', { exp: 999 }, 'GOOGLE_TOKEN_EXPIRED'],
  ])('rejects an invalid %s claim', (_name, change, message) => {
    expect(() => validateGoogleClaims({ ...base, ...change }, { audience: base.aud, nowSeconds: 1_000 })).toThrow(message);
  });
});
