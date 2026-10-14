import type { ReaderPreferencesStorage } from './readerPreferences';

/** Member-local opt in. Untouched v1 installs migrate off; explicit choices survive upgrades. */
export interface DevotionFollowSnapshot {
  readonly ready: boolean;
  readonly enabled: boolean;
  readonly touched: boolean;
  readonly firstOfferedOn?: string;
}
function storageKey(memberId: string): string {
  const encoded = Array.from(memberId, (character) => character.codePointAt(0)!.toString(16)).join('_');
  return `qingmu.devotion.follow.v1.m-${encoded || 'empty'}`;
}
const DEFAULT: DevotionFollowSnapshot = Object.freeze({ ready: true, enabled: false, touched: false });
const LOADING: DevotionFollowSnapshot = Object.freeze({ ready: false, enabled: false, touched: false });
const calendarDay = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) / 86400000 : NaN;

export function createDevotionPreferencesStore(storage: ReaderPreferencesStorage) {
  const snapshots = new Map<string | null, DevotionFollowSnapshot>();
  const listeners = new Set<() => void>();
  const publish = (memberId: string | null, next: DevotionFollowSnapshot) => { snapshots.set(memberId, Object.freeze(next)); listeners.forEach((listener) => listener()); };
  // Serialize writes: a slow exposure write must never overwrite a later explicit choice.
  const writes = new Map<string, Promise<void>>();
  const save = (memberId: string | null, next: DevotionFollowSnapshot) => {
    publish(memberId, next);
    if (memberId) {
      const value = JSON.stringify({ schemaVersion: 1, enabled: next.enabled, touched: next.touched, firstOfferedOn: next.firstOfferedOn });
      const write = (writes.get(memberId) ?? Promise.resolve()).then(() => storage.setItem(storageKey(memberId), value)).catch(() => undefined);
      writes.set(memberId, write);
      void write.then(() => { if (writes.get(memberId) === write) writes.delete(memberId); });
    }
  };
  const getSnapshot = (memberId: string | null): DevotionFollowSnapshot => snapshots.get(memberId) ?? (memberId ? LOADING : DEFAULT);
  const canOffer = (memberId: string | null, today: string) => {
    const current = getSnapshot(memberId);
    if (!memberId || !current.ready || current.touched) return false;
    if (!current.firstOfferedOn) return true;
    const days = calendarDay(today) - calendarDay(current.firstOfferedOn);
    return days >= 0 && days < 7;
  };
  return {
    getSnapshot, canOffer,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load(memberId: string | null) {
      if (!memberId || snapshots.get(memberId)?.ready) return;
      try {
        const raw = await storage.getItem(storageKey(memberId));
        const value = raw ? JSON.parse(raw) as { enabled?: unknown; touched?: unknown; firstOfferedOn?: unknown } : null;
        if (snapshots.get(memberId)?.ready) return;
        const touched = value?.touched === true;
        publish(memberId, { ready: true, enabled: touched && value?.enabled === true, touched,
          ...(typeof value?.firstOfferedOn === 'string' && Number.isFinite(calendarDay(value.firstOfferedOn)) ? { firstOfferedOn: value.firstOfferedOn } : {}) });
      } catch { if (!snapshots.get(memberId)?.ready) publish(memberId, DEFAULT); }
    },
    setEnabled(memberId: string | null, enabled: boolean) { save(memberId, { ...getSnapshot(memberId), ready: true, enabled, touched: true }); },
    recordOfferShown(memberId: string | null, today: string) {
      const current = getSnapshot(memberId);
      if (canOffer(memberId, today) && !current.firstOfferedOn) save(memberId, { ...current, firstOfferedOn: today });
    },
    firstFollow(memberId: string | null, today: string) {
      if (!canOffer(memberId, today)) return false;
      save(memberId, { ...getSnapshot(memberId), enabled: true, touched: true });
      return true;
    },
  };
}
export type DevotionPreferencesStore = ReturnType<typeof createDevotionPreferencesStore>;
