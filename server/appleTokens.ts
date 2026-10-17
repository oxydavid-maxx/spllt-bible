import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { APPLE_CLIENT_ID, verifyAppleIdToken } from './appleVerifier';

/** OAuth refresh tokens stay encrypted at rest; never return/log an Apple credential. */
export function sealAppleToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(`apple-token:${secret}`).digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString('base64url')).join('.');
}
export function openAppleToken(value: string, secret: string): string {
  const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(`apple-token:${secret}`).digest(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
}

export function createAppleTokenClient(options: { teamId: string; keyId: string; privateKey: string; fetchImpl?: typeof fetch; verifyIdToken?: typeof verifyAppleIdToken }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  async function request(path: 'token' | 'revoke', values: Record<string, string>) {
    const clientSecret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: options.keyId })
      .setIssuer(options.teamId).setSubject(APPLE_CLIENT_ID).setAudience('https://appleid.apple.com')
      .setIssuedAt().setExpirationTime('5m').sign(await importPKCS8(options.privateKey, 'ES256'));
    const response = await fetchImpl(`https://appleid.apple.com/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: APPLE_CLIENT_ID, client_secret: clientSecret, ...values }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('APPLE_TOKEN_SERVICE_FAILED');
    return response;
  }
  return {
    async exchangeCode(code: string, subject: string): Promise<string> {
      const response = await request('token', { grant_type: 'authorization_code', code });
      const body = await response.json() as { refresh_token?: string; id_token?: string };
      if (!body.refresh_token || !body.id_token || (await (options.verifyIdToken ?? verifyAppleIdToken)(body.id_token)).subject !== subject) throw new Error('APPLE_CODE_INVALID');
      return body.refresh_token;
    },
    async revoke(token: string): Promise<void> { await request('revoke', { token, token_type_hint: 'refresh_token' }); },
  };
}
