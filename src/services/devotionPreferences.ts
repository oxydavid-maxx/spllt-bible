import type { ReaderPreferencesStorage } from './readerPreferences';

/**
 * Member-local opt in, chosen only in the ⋯ menu (2026-10-17: the seven-day offer is gone; the reading end shows
 * 接著讀靈修 › instead). Untouched v1 installs migrate off; explicit choices survive upgrades.
 */
export interface DevotionFollowSnapshot {
  readonly ready: boolean;
  readonly enabled: boolean;
  readonly touched: boolean;
}
function storageKey(memberId: string): string {
  const encoded = Array.from(memberId, (character) => character.codePointAt(0)!.toString(16)).join('_');
  return `qingmu.devotion.follow.v1.m-${encoded || 'empty'}`;
}
const DEFAULT: DevotionFollowSnapshot = Object.freeze({ ready: true, enabled: false, touched: false });
const LOADING: DevotionFollowSnapshot = Object.freeze({ ready: false, enabled: false, touched: false });

export function createDevotionPreferencesStore(storage: ReaderPreferencesStorage) {
  const snapshots = new Map<string | null, DevotionFollowSnapshot>();
  const listeners = new Set<() => void>();
  const publish = (memberId: string | null, next: DevotionFollowSnapshot) => { snapshots.set(memberId, Object.freeze(next)); listeners.forEach((listener) => listener()); };
  // Serialize writes: a slow exposure write must never overwrite a later explicit choice.
  const writes = new Map<string, Promise<void>>();
  const save = (memberId: string | null, next: DevotionFollowSnapshot) => {
    publish(memberId, next);
    if (memberId) {
      const value = JSON.stringify({ schemaVersion: 1, enabled: next.enabled, touched: next.touched });
      const write = (writes.get(memberId) ?? Promise.resolve()).then(() => storage.setItem(storageKey(memberId), value)).catch(() => undefined);
      writes.set(memberId, write);
      void write.then(() => { if (writes.get(memberId) === write) writes.delete(memberId); });
    }
  };
  const getSnapshot = (memberId: string | null): DevotionFollowSnapshot => snapshots.get(memberId) ?? (memberId ? LOADING : DEFAULT);
  return {
    getSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load(memberId: string | null) {
      if (!memberId || snapshots.get(memberId)?.ready) return;
      try {
        const raw = await storage.getItem(storageKey(memberId));
        const value = raw ? JSON.parse(raw) as { enabled?: unknown; touched?: unknown } : null;
        if (snapshots.get(memberId)?.ready) return;
        const touched = value?.touched === true;
        publish(memberId, { ready: true, enabled: touched && value?.enabled === true, touched });
      } catch {
        // Unknown is not untouched: stay off until a preference can be read or the member explicitly
        // uses the menu. Never overwrite a choice made during the read.
        if (!snapshots.get(memberId)?.ready) publish(memberId, LOADING);
      }
    },
    setEnabled(memberId: string | null, enabled: boolean) { save(memberId, { ready: true, enabled, touched: true }); },
  };
}
export type DevotionPreferencesStore = ReturnType<typeof createDevotionPreferencesStore>;
