export interface AuthContext {
  memberId: string;
  mode: 'development-fixture' | 'google-session';
}

export type AuthFailure = { status: 401 | 403; error: 'AUTH_REQUIRED' | 'AUTH_INVALID' | 'UNKNOWN_MEMBER' };

export function authenticate(
  headers: Record<string, string | undefined>,
  fixtureToken: string,
  memberExists: (memberId: string) => boolean,
  /** Development fixture only: the member for a request that sends the token without x-qingmu-member-id, as the
   * points client does (a production session carries its member). Unset keeps such a request UNKNOWN_MEMBER. */
  defaultMemberId?: string,
): AuthContext | AuthFailure {
  const authorization = headers.authorization ?? headers.Authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token !== fixtureToken) return { status: 401, error: 'AUTH_REQUIRED' };
  const memberId = headers['x-qingmu-member-id'] ?? defaultMemberId;
  if (!memberId || !memberExists(memberId)) return { status: 403, error: 'UNKNOWN_MEMBER' };
  return { memberId, mode: 'development-fixture' };
}

export interface GoogleIdentityForSession {
  subject: string;
  provider: 'google';
  displayName?: string;
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
  sessions?: { resolveDevice: (token: string) => string | null; isLegacyRevoked: (token: string) => boolean },
): Promise<AuthContext | AuthFailure> {
  const authorization = headers.authorization ?? headers.Authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { status: 401, error: 'AUTH_REQUIRED' };
  if (token.startsWith('qmd_')) {
    const memberId = sessions?.resolveDevice(token);
    return memberId ? { memberId, mode: 'google-session' } : { status: 401, error: 'AUTH_INVALID' };
  }
  if (token.startsWith('qms_') && sessions?.isLegacyRevoked(token)) return { status: 401, error: 'AUTH_INVALID' };
  const sessionMember = verifySessionToken(token, sessionSecret);
  if (sessionMember) return { memberId: sessionMember, mode: 'google-session' };
  return authenticateGoogle(headers, config);
}
import { verifySessionToken } from './session';
