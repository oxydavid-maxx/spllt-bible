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
