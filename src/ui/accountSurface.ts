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
 * A downloaded update (docs/eas-update.md) keeps the store version, so its day and the start of its ID
 * follow, e.g. 版本 0.5.35 (60) · 更新 20261020-0a1b2c; the store build's own copy adds nothing.
 */
export interface RunningUpdate { isEmbeddedLaunch: boolean; updateId: string | null; createdAt: Date | null }

export function appVersionLabel(version: string | null, build: string | null, update?: RunningUpdate | null): string | null {
  const name = version?.trim();
  if (!name) return null;
  const code = build?.trim();
  const label = code ? `版本 ${name} (${code})` : `版本 ${name}`;
  const id = update && !update.isEmbeddedLaunch ? update.updateId?.replace(/-/g, '').slice(0, 6) : null;
  if (!id) return label;
  const at = update?.createdAt;
  const day = at ? `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}-` : '';
  return `${label} · 更新 ${day}${id}`;
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
