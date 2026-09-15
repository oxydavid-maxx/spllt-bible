import type { ReaderPreferencesStorage } from './readerPreferences';

export interface ReaderAutoplayPreferences {
  readonly enabled: boolean;
}

export interface ReaderAutoplayPreferenceSnapshot {
  readonly ready: boolean;
  readonly preferences: ReaderAutoplayPreferences;
  readonly readError: boolean;
  readonly saveError: boolean;
}

export interface ReaderAutoplayPreferencesStore {
  getSnapshot(memberId: string | null): ReaderAutoplayPreferenceSnapshot;
  subscribe(listener: () => void): () => void;
  load(memberId: string | null): Promise<void>;
  update(memberId: string | null, enabled: boolean): Promise<void>;
  retrySave(memberId: string | null): Promise<void>;
}

interface Entry {
  snapshot: ReaderAutoplayPreferenceSnapshot;
  revision: number;
  loading: Promise<void> | null;
  writeTail: Promise<void>;
}

function storageKey(memberId: string): string {
  const encoded = Array.from(memberId, character => character.codePointAt(0)!.toString(16)).join('_');
  return `qingmu.reader.autoplay.v1.m-${encoded || 'empty'}`;
}

const defaults = (): ReaderAutoplayPreferences => Object.freeze({ enabled: true });
const samePreferences = (left: ReaderAutoplayPreferences, right: ReaderAutoplayPreferences) => left.enabled === right.enabled;

function snapshotEquals(left: ReaderAutoplayPreferenceSnapshot, right: ReaderAutoplayPreferenceSnapshot): boolean {
  return left.ready === right.ready && left.readError === right.readError && left.saveError === right.saveError
    && samePreferences(left.preferences, right.preferences);
}

export function createReaderAutoplayPreferencesStore(storage: ReaderPreferencesStorage): ReaderAutoplayPreferencesStore {
  const entries = new Map<string | null, Entry>();
  const listeners = new Set<() => void>();

  function entryFor(memberId: string | null): Entry {
    let entry = entries.get(memberId);
    if (!entry) {
      entry = {
        snapshot: Object.freeze({ ready: memberId === null, preferences: defaults(), readError: false, saveError: false }),
        revision: 0,
        loading: null,
        writeTail: Promise.resolve(),
      };
      entries.set(memberId, entry);
    }
    return entry;
  }

  function publish(entry: Entry, next: ReaderAutoplayPreferenceSnapshot): void {
    if (snapshotEquals(entry.snapshot, next)) return;
    entry.snapshot = Object.freeze(next);
    listeners.forEach(listener => listener());
  }

  function parse(raw: unknown): ReaderAutoplayPreferences | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    // New accounts and older records without this optional field use the product default.
    if (value.enabled === undefined) return defaults();
    return typeof value.enabled === 'boolean' ? Object.freeze({ enabled: value.enabled }) : null;
  }

  function enqueueSave(memberId: string, entry: Entry, preferences: ReaderAutoplayPreferences, revision: number): Promise<void> {
    const payload = JSON.stringify({ schemaVersion: 1, owner: memberId, preferences });
    const operation = entry.writeTail.then(async () => {
      let failed = false;
      try { await storage.setItem(storageKey(memberId), payload); }
      catch { failed = true; }
      if (entry.revision === revision) publish(entry, { ...entry.snapshot, saveError: failed });
    });
    entry.writeTail = operation.catch(() => undefined);
    return operation;
  }

  function load(memberId: string | null): Promise<void> {
    const entry = entryFor(memberId);
    if (memberId === null || (entry.snapshot.ready && !entry.snapshot.readError)) return Promise.resolve();
    if (entry.loading) return entry.loading;
    const startedAtRevision = entry.revision;
    const task = (async () => {
      let raw: string | null;
      try { raw = await storage.getItem(storageKey(memberId)); }
      catch {
        if (entry.revision === startedAtRevision) publish(entry, { ...entry.snapshot, ready: true, readError: true });
        return;
      }
      if (entry.revision !== startedAtRevision) return;
      let preferences: ReaderAutoplayPreferences | null = raw === null ? defaults() : null;
      let shouldMigrate = false;
      if (raw !== null) {
        try {
          const envelope = JSON.parse(raw) as { schemaVersion?: unknown; owner?: unknown; preferences?: unknown } | null;
          if (envelope?.schemaVersion === 1 && envelope.owner === memberId) {
            preferences = parse(envelope.preferences);
            const rawPreferences = envelope.preferences as Record<string, unknown> | null | undefined;
            shouldMigrate = Boolean(preferences && rawPreferences && rawPreferences.enabled === undefined);
          }
        } catch { /* corrupt record: keep the safe default and expose only a boolean read error */ }
      }
      publish(entry, { ...entry.snapshot, ready: true, preferences: preferences ?? defaults(), readError: preferences === null });
      if (shouldMigrate && preferences && entry.revision === startedAtRevision) await enqueueSave(memberId, entry, preferences, startedAtRevision);
    })();
    const loading: Promise<void> = task.finally(() => { if (entry.loading === loading) entry.loading = null; });
    entry.loading = loading;
    return loading;
  }

  function update(memberId: string | null, enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('INVALID_READER_AUTOPLAY_PREFERENCE'));
    const entry = entryFor(memberId);
    if (entry.snapshot.ready && !entry.snapshot.readError && !entry.snapshot.saveError && entry.snapshot.preferences.enabled === enabled) return Promise.resolve();
    const revision = ++entry.revision;
    const preferences = Object.freeze({ enabled });
    publish(entry, { ready: true, preferences, readError: false, saveError: false });
    if (memberId === null) return Promise.resolve();
    return enqueueSave(memberId, entry, preferences, revision);
  }

  function retrySave(memberId: string | null): Promise<void> {
    const entry = entryFor(memberId);
    if (memberId === null || !entry.snapshot.ready || !entry.snapshot.saveError) return Promise.resolve();
    publish(entry, { ...entry.snapshot, saveError: false });
    return enqueueSave(memberId, entry, entry.snapshot.preferences, entry.revision);
  }

  return {
    getSnapshot: memberId => entryFor(memberId).snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    update,
    retrySave,
  };
}
