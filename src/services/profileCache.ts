import type { ScoreProfile } from '../domain/gamificationV1';

/**
 * The member's own points, kept on the device so a server that is down does not blank the page.
 *
 * Only ever their own. Caching a friend's profile, or an administrator's view of the whole group,
 * would put other people's totals on this phone where they would outlive the session that was
 * allowed to see them — a quietly larger disclosure than the one the API makes. The save path
 * refuses anything that is not the signed-in member's own profile, and the load path checks again,
 * because the two calls are far apart in the page that uses them.
 */

const KEY_PREFIX = 'qingmu.profile.';

export interface ProfileCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createProfileCache(storage: ProfileCacheStorage) {
  // SecureStore accepts only alphanumerics, '.', '-' and '_'; member IDs include ':'.
  const key = (memberId: string) => `${KEY_PREFIX}v2.${Array.from(memberId, (character) => character.codePointAt(0)!.toString(16)).join('_')}`;

  return {
    async save(memberId: string, profile: ScoreProfile): Promise<void> {
      if (!memberId || profile.memberId !== memberId) return;
      try { await storage.setItem(key(memberId), JSON.stringify(profile)); } catch { /* a cache that cannot write is still a working app */ }
    },

    async load(memberId: string): Promise<ScoreProfile | null> {
      if (!memberId) return null;
      try {
        let raw = await storage.getItem(key(memberId));
        // Preserve caches written for older IDs whose legacy keys were valid on device.
        const legacyKey = `${KEY_PREFIX}${memberId}`;
        if (!raw && /^[\w.-]+$/.test(legacyKey)) raw = await storage.getItem(legacyKey);
        if (!raw) return null;
        const profile = JSON.parse(raw) as ScoreProfile;
        // Switching accounts must not surface the previous one, even if a key were reused.
        return profile && profile.memberId === memberId ? profile : null;
      } catch {
        return null;
      }
    },
  };
}
