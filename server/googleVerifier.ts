import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface GoogleClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
}

export interface VerifiedGoogleIdentity {
  provider: 'google';
  subject: string;
  email?: string;
  displayName?: string;
}

export function validateGoogleClaims(
  claims: GoogleClaims,
  options: { audience: string; nowSeconds?: number },
): VerifiedGoogleIdentity {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) throw new Error('GOOGLE_ISSUER_INVALID');
  if (claims.aud !== options.audience) throw new Error('GOOGLE_AUDIENCE_INVALID');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('GOOGLE_TOKEN_EXPIRED');
  if (!claims.sub?.trim()) throw new Error('GOOGLE_SUBJECT_MISSING');
  return {
    provider: 'google',
    subject: claims.sub,
    ...(claims.email ? { email: claims.email } : {}),
    ...(claims.name ? { displayName: claims.name } : {}),
  };
}

export async function verifyGoogleIdToken(
  idToken: string,
  options: { audience: string; jwks?: ReturnType<typeof createRemoteJWKSet>; nowSeconds?: number },
): Promise<VerifiedGoogleIdentity> {
  const result = await jwtVerify(idToken, options.jwks ?? GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: options.audience,
  });
  return validateGoogleClaims(result.payload as GoogleClaims, options);
}
