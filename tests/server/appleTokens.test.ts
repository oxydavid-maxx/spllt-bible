import { exportPKCS8, generateKeyPair, decodeJwt } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createAppleTokenClient, openAppleToken, sealAppleToken } from '../../server/appleTokens';

describe('Apple authorization code exchange, encrypted storage and revocation', () => {
  it('encrypts refresh tokens with integrity protection', () => {
    const sealed = sealAppleToken('synthetic-refresh', 'test-secret');
    expect(sealed).not.toContain('synthetic-refresh');
    expect(openAppleToken(sealed, 'test-secret')).toBe('synthetic-refresh');
    expect(() => openAppleToken(sealed, 'wrong-secret')).toThrow();
  });
  it('uses the official form endpoints and verifies the returned subject before accepting a code', async () => {
    const key = await generateKeyPair('ES256', { extractable: true });
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get('client_id')).toBe('org.qingmu.youth');
      expect(decodeJwt(body.get('client_secret')!)).toMatchObject({ iss: 'test-team', sub: 'org.qingmu.youth', aud: 'https://appleid.apple.com' });
      return new Response(String(url).endsWith('/token') ? JSON.stringify({ refresh_token: 'synthetic-refresh', id_token: 'synthetic-id' }) : '', { status: 200 });
    });
    const verifyIdToken = vi.fn(async () => ({ provider: 'apple' as const, subject: 'synthetic-sub' }));
    const client = createAppleTokenClient({ teamId: 'test-team', keyId: 'test-key', privateKey: await exportPKCS8(key.privateKey), fetchImpl: fetchImpl as typeof fetch, verifyIdToken });
    expect(await client.exchangeCode('synthetic-code', 'synthetic-sub')).toBe('synthetic-refresh');
    await client.revoke('synthetic-refresh');
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual(['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/revoke']);
    expect((fetchImpl.mock.calls[1][1]!.body as URLSearchParams).get('token_type_hint')).toBe('refresh_token');
    await expect(client.exchangeCode('synthetic-code', 'foreign-sub')).rejects.toThrow('APPLE_CODE_INVALID');
  });
});
