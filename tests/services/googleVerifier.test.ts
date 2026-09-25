import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateGoogleClaims, verifyGoogleIdTokenAnyAudience } from '../../server/googleVerifier';

describe('Google token verification for a caller that pins its own audience', () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let jwks: ReturnType<typeof createLocalJWKSet>;
  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  });
  const sign = (claims: Record<string, unknown>, expiresAt = Math.floor(Date.now() / 1000) + 600) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setExpirationTime(expiresAt).sign(privateKey);

  it('returns the subject and whichever audience Google signed for', async () => {
    const token = await sign({ iss: 'https://accounts.google.com', aud: 'script-client', sub: 'owner-sub' });
    await expect(verifyGoogleIdTokenAnyAudience(token, { jwks })).resolves.toEqual({ subject: 'owner-sub', audience: 'script-client' });
  });

  it.each([
    ['a foreign issuer', { iss: 'https://evil.example', aud: 'script-client', sub: 'owner-sub' }, undefined],
    ['an expired token', { iss: 'https://accounts.google.com', aud: 'script-client', sub: 'owner-sub' }, 1_000],
    ['several audiences', { iss: 'https://accounts.google.com', aud: ['a', 'b'], sub: 'owner-sub' }, undefined],
  ])('rejects %s', async (_name, claims, expiresAt) => {
    await expect(verifyGoogleIdTokenAnyAudience(await sign(claims, expiresAt), { jwks })).rejects.toThrow();
  });

  it('rejects a token signed by someone else', async () => {
    const other = await generateKeyPair('RS256');
    const token = await new SignJWT({ iss: 'https://accounts.google.com', aud: 'script-client', sub: 'owner-sub' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setExpirationTime('10m').sign(other.privateKey);
    await expect(verifyGoogleIdTokenAnyAudience(token, { jwks })).rejects.toThrow();
  });
});

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
