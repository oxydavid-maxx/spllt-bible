import type { ReaderPreferencesStorage } from './readerPreferences';

/**
 * 「跟傳道一起讀」 in the reader's ⋯ (維護者 2026-10-14): when on, the last chapter's narration hands
 * over to the 靈修, and the 靈修 to its song (only while the screen is on). On by default. The first
 * press of the gold 「跟傳道一起讀 ›」 also switches it on, once; after a member turns it off
 * themselves, it stays off.
 */

export interface DevotionFollowSnapshot {
  readonly ready: boolean;
  readonly enabled: boolean;
  /** The member has set it themselves, or the first gold press already set it. */
  readonly touched: boolean;
}

function storageKey(memberId: string): string {
  const encoded = Array.from(memberId, (character) => character.codePointAt(0)!.toString(16)).join('_');
  return `qingmu.devotion.follow.v1.m-${encoded || 'empty'}`;
}

const DEFAULT: DevotionFollowSnapshot = Object.freeze({ ready: true, enabled: true, touched: false });
// The same object every read until it loads, as useSyncExternalStore requires.
const LOADING: DevotionFollowSnapshot = Object.freeze({ ready: false, enabled: true, touched: false });

export function createDevotionPreferencesStore(storage: ReaderPreferencesStorage) {
  const snapshots = new Map<string | null, DevotionFollowSnapshot>();
  const listeners = new Set<() => void>();
  const publish = (memberId: string | null, next: DevotionFollowSnapshot) => { snapshots.set(memberId, Object.freeze(next)); listeners.forEach((listener) => listener()); };
  const save = (memberId: string | null, next: DevotionFollowSnapshot) => {
    publish(memberId, next);
    if (memberId) void storage.setItem(storageKey(memberId), JSON.stringify({ schemaVersion: 1, enabled: next.enabled, touched: next.touched })).catch(() => undefined);
  };
  return {
    getSnapshot: (memberId: string | null): DevotionFollowSnapshot => snapshots.get(memberId) ?? (memberId ? LOADING : DEFAULT),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load(memberId: string | null) {
      if (!memberId || snapshots.get(memberId)?.ready) return;
      try {
        const raw = await storage.getItem(storageKey(memberId));
        const value = raw ? JSON.parse(raw) as { enabled?: unknown; touched?: unknown } : null;
        publish(memberId, value && typeof value.enabled === 'boolean' ? { ready: true, enabled: value.enabled, touched: value.touched === true } : DEFAULT);
      } catch { publish(memberId, DEFAULT); }
    },
    setEnabled(memberId: string | null, enabled: boolean) { save(memberId, { ready: true, enabled, touched: true }); },
    /** The first gold press: on, once. */
    firstFollow(memberId: string | null) {
      const current = snapshots.get(memberId) ?? DEFAULT;
      if (!current.touched) save(memberId, { ready: true, enabled: true, touched: true });
    },
  };
}

export type DevotionPreferencesStore = ReturnType<typeof createDevotionPreferencesStore>;
