import type { AuthSnapshot, VerifiedProfile } from '../services/authSession';

export interface AccountSurfaceModel {
  mode: 'signed-out' | 'reauthenticate' | 'signed-in' | 'loading' | 'empty' | 'error';
  /** true only when a retry can actually change the outcome */
  canRetry?: boolean;
  displayName?: string;
  avatarLabel?: string;
  avatarUrl?: string | null;
  groupName?: string | null;
  showSignIn: boolean;
}

function initial(profile: VerifiedProfile): string {
  return profile.displayName.trim().slice(0, 1) || '你';
}

/**
 * The installed version as testers report it, e.g. 版本 0.5.24 (47). The number in brackets is the
 * versionCode Google Play counts, so "which build do you have" has one answer. null when the native
 * version cannot be read (tests, web), so the page shows nothing rather than an invented version.
 */
export function appVersionLabel(version: string | null, build: string | null): string | null {
  const name = version?.trim();
  if (!name) return null;
  const code = build?.trim();
  return code ? `版本 ${name} (${code})` : `版本 ${name}`;
}

export function buildAccountSurfaceModel(snapshot: Pick<AuthSnapshot, 'status' | 'profile' | 'profileStatus'>): AccountSurfaceModel {
  if (snapshot.status === 'signed-in' && snapshot.profile) {
    return {
      mode: 'signed-in',
      displayName: snapshot.profile.displayName,
      avatarLabel: initial(snapshot.profile),
      avatarUrl: snapshot.profile.avatarUrl?.trim() || null,
      groupName: snapshot.profile.groupName,
      showSignIn: false,
    };
  }
  if (snapshot.status === 'signed-in') {
    // Review 121 C9. A finished-but-failed load is NOT loading. Only an in-flight request spins.
    if (snapshot.profileStatus === 'error') return { mode: 'error', showSignIn: false, canRetry: true };
    if (snapshot.profileStatus === 'empty') return { mode: 'empty', showSignIn: false, canRetry: true };
    return { mode: 'loading', showSignIn: false };
  }
  if (snapshot.status === 'expired') return { mode: 'reauthenticate', showSignIn: true };
  return { mode: 'signed-out', showSignIn: true };
}
