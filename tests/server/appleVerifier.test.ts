import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyAppleIdToken } from '../../server/appleVerifier';

describe('Apple identity signature and claims', () => {
  let key: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let jwks: ReturnType<typeof createLocalJWKSet>;
  const now = 1_800_000_000;
  beforeAll(async () => {
    const pair = await generateKeyPair('RS256'); key = pair.privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test', alg: 'RS256' }] });
  });
  const token = (change: Record<string, unknown> = {}, signer = key) => new SignJWT({
    sub: 'fake-apple-sub', iss: 'https://appleid.apple.com', aud: 'org.qingmu.youth', iat: now - 5, exp: now + 300, nonce: 'challenge', ...change,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(signer);
  it('accepts the exact native audience and challenge', async () => {
    expect(await verifyAppleIdToken(await token(), { jwks, nonce: 'challenge', nowSeconds: now })).toEqual({ provider: 'apple', subject: 'fake-apple-sub' });
  });
  it.each([
    ['audience', { aud: 'other.bundle' }], ['audience array', { aud: ['org.qingmu.youth', 'other'] }],
    ['issuer', { iss: 'https://evil.test' }], ['expiry', { exp: now - 1 }], ['missing expiry', { exp: undefined }],
    ['subject', { sub: '' }], ['nonce', { nonce: 'other' }],
  ])('rejects invalid %s', async (_, change) => {
    await expect(verifyAppleIdToken(await token(change), { jwks, nonce: 'challenge', nowSeconds: now })).rejects.toThrow();
  });
  it('rejects a forged signature', async () => {
    const other = await generateKeyPair('RS256');
    await expect(verifyAppleIdToken(await token({}, other.privateKey), { jwks, nowSeconds: now })).rejects.toThrow();
  });
});
