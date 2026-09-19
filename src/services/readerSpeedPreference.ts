import type { ReaderPreferencesStorage } from './readerPreferences';

/**
 * How fast the narration plays, remembered per member.
 *
 * Someone who reads along at 1.25 wants 1.25 tomorrow as well, so this persists rather than
 * resetting each time the reader opens. It is kept in its own key rather than folded into the
 * continuous-reading preference, so a stored value that predates this feature keeps working and
 * neither setting can corrupt the other.
 *
 * Pitch correction stays on: sped-up narration that also rises in pitch sounds like a cartoon, and
 * this is scripture being read aloud.
 */

/** Slower for following along, faster for a second pass. Anything wider stops being useful. */
export const READER_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
export type ReaderSpeed = (typeof READER_SPEEDS)[number];

export const DEFAULT_READER_SPEED: ReaderSpeed = 1;

export function isReaderSpeed(value: unknown): value is ReaderSpeed {
  return typeof value === 'number' && (READER_SPEEDS as readonly number[]).includes(value);
}

export function storageKey(memberId: string): string {
  const encoded = Array.from(memberId, (character) => character.codePointAt(0)!.toString(16)).join('_');
  return `qingmu.reader.speed.v1.m-${encoded || 'empty'}`;
}

export interface ReaderSpeedStore {
  getSpeed(memberId: string | null): ReaderSpeed;
  subscribe(listener: () => void): () => void;
  load(memberId: string | null): Promise<void>;
  update(memberId: string | null, speed: ReaderSpeed): Promise<void>;
}

export function createReaderSpeedStore(storage: ReaderPreferencesStorage): ReaderSpeedStore {
  const speeds = new Map<string, ReaderSpeed>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    getSpeed: (memberId) => (memberId ? speeds.get(memberId) ?? DEFAULT_READER_SPEED : DEFAULT_READER_SPEED),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load(memberId) {
      if (!memberId || speeds.has(memberId)) return;
      try {
        const stored = await storage.getItem(storageKey(memberId));
        const parsed = stored === null ? null : Number(stored);
        // A speed we no longer offer, or a corrupted value, falls back to normal rather than
        // leaving someone stuck at a rate they cannot see in the menu and cannot change.
        speeds.set(memberId, isReaderSpeed(parsed) ? parsed : DEFAULT_READER_SPEED);
      } catch {
        speeds.set(memberId, DEFAULT_READER_SPEED);
      }
      notify();
    },
    async update(memberId, speed) {
      if (!memberId || !isReaderSpeed(speed)) return;
      speeds.set(memberId, speed);
      notify();
      // Applied immediately above; a failed write only means it will not be remembered next time,
      // which is not worth interrupting playback to report.
      try { await storage.setItem(storageKey(memberId), String(speed)); } catch { /* best effort */ }
    },
  };
}
