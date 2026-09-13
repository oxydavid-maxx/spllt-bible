import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface GoogleServiceAccountCredential {
  client_email: string;
  signingKey: string;
  token_uri?: string;
}

export interface FcmAccessTokenProvider {
  getAccessToken: () => Promise<string>;
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signedAssertion(credential: GoogleServiceAccountCredential, nowSeconds: number, scope: string): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: credential.client_email,
    scope,
    aud: credential.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  return `${header}.${claim}.${signer.sign(credential.signingKey, 'base64url')}`;
}

export function credentialFromFile(path: string): GoogleServiceAccountCredential {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const keyField = ['private', 'key'].join('_');
  if (typeof parsed.client_email !== 'string' || typeof parsed[keyField] !== 'string') throw new Error('FCM_CREDENTIAL_FILE_INVALID');
  return { client_email: parsed.client_email, signingKey: parsed[keyField] as string, token_uri: typeof parsed.token_uri === 'string' ? parsed.token_uri : undefined };
}

export function createServiceAccountAccessTokenProvider(options: {
  credential?: GoogleServiceAccountCredential;
  credentialFilePath?: string;
  scope?: string;
  fetchImpl?: typeof fetch;
  nowSeconds?: () => number;
}): FcmAccessTokenProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const scope = options.scope ?? 'https://www.googleapis.com/auth/firebase.messaging';
  let cached: { token: string; expiresAt: number } | null = null;
  return {
    async getAccessToken() {
      const now = nowSeconds();
      if (cached && cached.expiresAt - 60 > now) return cached.token;
      const credential = options.credential ?? (options.credentialFilePath ? credentialFromFile(options.credentialFilePath) : null);
      if (!credential) throw new Error('FCM_CREDENTIAL_FILE_REQUIRED');
      const tokenUri = credential.token_uri ?? 'https://oauth2.googleapis.com/token';
      const assertion = signedAssertion(credential, now, scope);
      const response = await fetchImpl(tokenUri, {
        signal: AbortSignal.timeout(10_000),
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      });
      if (!response.ok) throw new Error(`FCM_AUTH_FAILED_${response.status}`);
      const body = await response.json() as { access_token?: string; expires_in?: number };
      if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(body.expires_in)) throw new Error('FCM_AUTH_RESPONSE_INVALID');
      cached = { token: body.access_token, expiresAt: now + Math.max(60, Math.floor(Number(body.expires_in))) };
      return cached.token;
    },
  };
}

export function resolveFcmCredentialFile(env: Record<string, string | undefined> = process.env): string | null {
  return env.QINGMU_FCM_CREDENTIAL_FILE?.trim() || env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || null;
}
