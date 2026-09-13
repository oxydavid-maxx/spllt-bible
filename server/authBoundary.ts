export interface AuthContext {
  memberId: string;
  mode: 'development-fixture' | 'google-session';
}

export type AuthFailure = { status: 401 | 403; error: 'AUTH_REQUIRED' | 'AUTH_INVALID' | 'UNKNOWN_MEMBER' };

export function authenticate(
  headers: Record<string, string | undefined>,
  fixtureToken: string,
  memberExists: (memberId: string) => boolean,
): AuthContext | AuthFailure {
  const authorization = headers.authorization ?? headers.Authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token !== fixtureToken) return { status: 401, error: 'AUTH_REQUIRED' };
  const memberId = headers['x-qingmu-member-id'];
  if (!memberId || !memberExists(memberId)) return { status: 403, error: 'UNKNOWN_MEMBER' };
  return { memberId, mode: 'development-fixture' };
}

export interface GoogleIdentityForSession {
  subject: string;
  provider: 'google';
}

export interface ProductionGoogleAuth {
  verify: (idToken: string) => Promise<GoogleIdentityForSession>;
  resolveMember: (identity: GoogleIdentityForSession) => Promise<string | null>;
}

export async function authenticateGoogle(
  headers: Record<string, string | undefined>,
  config: ProductionGoogleAuth,
): Promise<AuthContext | AuthFailure> {
  const authorization = headers.authorization ?? headers.Authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { status: 401, error: 'AUTH_REQUIRED' };
  try {
    const identity = await config.verify(token);
    const memberId = await config.resolveMember(identity);
    if (!memberId) return { status: 403, error: 'UNKNOWN_MEMBER' };
    return { memberId, mode: 'google-session' };
  } catch {
    return { status: 401, error: 'AUTH_INVALID' };
  }
}

export async function authenticateSessionOrGoogle(
  headers: Record<string, string | undefined>,
  config: ProductionGoogleAuth,
  sessionSecret: string,
): Promise<AuthContext | AuthFailure> {
  const authorization = headers.authorization ?? headers.Authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { status: 401, error: 'AUTH_REQUIRED' };
  const sessionMember = verifySessionToken(token, sessionSecret);
  if (sessionMember) return { memberId: sessionMember, mode: 'google-session' };
  return authenticateGoogle(headers, config);
}
import { verifySessionToken } from './session';
