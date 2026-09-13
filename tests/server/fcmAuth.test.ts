import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createServiceAccountAccessTokenProvider, resolveFcmCredentialFile } from '../../server/fcmAuth';

describe('FCM service account auth', () => {
  it('refreshes before expiry using the Firebase Messaging scope without a static token', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    let now = 1000;
    let requests = 0;
    const provider = createServiceAccountAccessTokenProvider({ credential: { client_email: 'sender@example.iam.gserviceaccount.com', signingKey: pem, token_uri: 'https://oauth2.example/token' }, nowSeconds: () => now, fetchImpl: async (_input, init) => {
      requests += 1;
      expect(String(init?.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
      return new Response(JSON.stringify({ access_token: `access-${requests}`, expires_in: 100 }), { status: 200 });
    } });
    await expect(provider.getAccessToken()).resolves.toBe('access-1');
    now = 1030;
    await expect(provider.getAccessToken()).resolves.toBe('access-1');
    now = 1041;
    await expect(provider.getAccessToken()).resolves.toBe('access-2');
    expect(requests).toBe(2);
  });

  it('accepts the protected credential file/ADC path without exposing its value', () => {
    expect(resolveFcmCredentialFile({ QINGMU_FCM_CREDENTIAL_FILE: 'C:\\private\\fcm.json' })).toBe('C:\\private\\fcm.json');
    expect(resolveFcmCredentialFile({ GOOGLE_APPLICATION_CREDENTIALS: 'C:\\private\\adc.json' })).toBe('C:\\private\\adc.json');
    expect(resolveFcmCredentialFile({})).toBeNull();
  });
});
