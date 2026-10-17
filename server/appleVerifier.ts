import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const APPLE_CLIENT_ID = 'org.qingmu.youth';
const keys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
export interface AppleIdentity { provider: 'apple'; subject: string; }

/** Trust only Apple's signature and this native bundle; email/name are not identity keys. */
export async function verifyAppleIdToken(token: string, options: { jwks?: JWTVerifyGetKey; nonce?: string; nowSeconds?: number } = {}): Promise<AppleIdentity> {
  const { payload } = await jwtVerify(token, options.jwks ?? keys, {
    algorithms: ['RS256'], issuer: 'https://appleid.apple.com', audience: APPLE_CLIENT_ID,
    requiredClaims: ['sub', 'exp', 'iat'],
    ...(options.nowSeconds === undefined ? {} : { currentDate: new Date(options.nowSeconds * 1000) }),
  });
  if (payload.aud !== APPLE_CLIENT_ID || !payload.sub?.trim() || (options.nonce !== undefined && payload.nonce !== options.nonce)) throw new Error('APPLE_CLAIMS_INVALID');
  return { provider: 'apple', subject: payload.sub };
}
