export interface ReaderPreferencesStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface ReaderSettings {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly lineSpacing: number;
}

export interface ReaderPreferences {
  readonly versionId: number;
  readonly settings: ReaderSettings | null;
}

export interface ReaderPreferencesSnapshot {
  readonly ready: boolean;
  readonly preferences: ReaderPreferences;
  readonly readError: boolean;
  readonly saveError: boolean;
}

export interface ReaderPreferencesPatch {
  versionId?: number;
  settings?: ReaderSettings | null;
}

export interface ReaderPreferencesStore {
  getSnapshot(memberId: string | null): ReaderPreferencesSnapshot;
  subscribe(listener: () => void): () => void;
  load(memberId: string | null): Promise<void>;
  update(memberId: string | null, patch: ReaderPreferencesPatch): Promise<void>;
  retrySave(memberId: string | null): Promise<void>;
}

interface Entry {
  snapshot: ReaderPreferencesSnapshot;
  revision: number;
  loading: Promise<void> | null;
  writeTail: Promise<void>;
}

function storageKey(memberId: string): string {
  // Delimited code points are injective, including punctuation and non-BMP characters.
  // 'empty' cannot collide with a hex code-point sequence. Null/guest never has a disk key.
  const encoded = Array.from(memberId, character => character.codePointAt(0)!.toString(16)).join('_');
  return `qingmu.reader.preferences.v1.m-${encoded || 'empty'}`;
}

function samePreferences(a: ReaderPreferences, b: ReaderPreferences): boolean {
  return a.versionId === b.versionId && (a.settings === b.settings || Boolean(a.settings && b.settings
    && a.settings.fontSize === b.settings.fontSize && a.settings.fontFamily === b.settings.fontFamily
    && a.settings.lineSpacing === b.settings.lineSpacing));
}

/** Local device preferences only. No React/native I/O, position, completion or cross-device sync. */
export function createReaderPreferencesStore(
  storage: ReaderPreferencesStorage,
  options: { allowedVersionIds: readonly number[]; defaultVersionId?: number; retiredVersionIds?: readonly number[] },
): ReaderPreferencesStore {
  const defaultVersionId = options.defaultVersionId ?? 46;
  const allowed = new Set(options.allowedVersionIds);
  const retired = new Set(options.retiredVersionIds ?? []);
  if (!Number.isSafeInteger(defaultVersionId) || defaultVersionId <= 0 || !allowed.has(defaultVersionId)) {
    throw new Error('DEFAULT_VERSION_NOT_ALLOWED');
  }
  const entries = new Map<string | null, Entry>();
  const listeners = new Set<() => void>();
  const defaults = (): ReaderPreferences => Object.freeze({ versionId: defaultVersionId, settings: null });

  function entryFor(memberId: string | null): Entry {
    let entry = entries.get(memberId);
    if (!entry) {
      entry = {
        snapshot: Object.freeze({ ready: memberId === null, preferences: defaults(), readError: false, saveError: false }),
        revision: 0, loading: null, writeTail: Promise.resolve(),
      };
      entries.set(memberId, entry);
    }
    return entry;
  }

  function publish(entry: Entry, next: ReaderPreferencesSnapshot): void {
    const current = entry.snapshot;
    if (current.ready === next.ready && current.readError === next.readError && current.saveError === next.saveError
      && samePreferences(current.preferences, next.preferences)) return;
    entry.snapshot = Object.freeze(next);
    listeners.forEach(listener => listener());
  }

  function normalize(raw: unknown, migrateRemovedVersion = false): ReaderPreferences | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const preferences = raw as Record<string, unknown>;
    const storedVersionId = preferences.versionId;
    if (typeof storedVersionId !== 'number' || !Number.isSafeInteger(storedVersionId) || storedVersionId <= 0) return null;
    if (!allowed.has(storedVersionId) && !(migrateRemovedVersion && retired.has(storedVersionId))) return null;
    const versionId = allowed.has(storedVersionId) ? storedVersionId : defaultVersionId;
    const rawSettings = preferences.settings;
    if (rawSettings === null) return Object.freeze({ versionId, settings: null });
    if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) return null;
    const settings = rawSettings as Record<string, unknown>;
    const { fontSize, fontFamily, lineSpacing } = settings;
    if (typeof fontSize !== 'number' || !Number.isFinite(fontSize) || fontSize < 8 || fontSize > 96
      || typeof lineSpacing !== 'number' || !Number.isFinite(lineSpacing) || lineSpacing < 0.5 || lineSpacing > 5
      || typeof fontFamily !== 'string' || fontFamily.trim().length === 0 || fontFamily.trim().length > 128
      || /[\u0000-\u001f\u007f-\u009f]/u.test(fontFamily)) return null;
    return Object.freeze({ versionId, settings: Object.freeze({ fontSize, fontFamily: fontFamily.trim(), lineSpacing }) });
  }

  function load(memberId: string | null): Promise<void> {
    const entry = entryFor(memberId);
    if (memberId === null) return Promise.resolve();
    if (entry.loading) return entry.loading;
    if (entry.snapshot.ready && !entry.snapshot.readError) return Promise.resolve();
    const startedAtRevision = entry.revision;
    const task = (async () => {
      let raw: string | null;
      try { raw = await storage.getItem(storageKey(memberId)); }
      catch {
        if (entry.revision === startedAtRevision) publish(entry, { ...entry.snapshot, ready: true, readError: true });
        return;
      }
      // A user edit owns the complete current choice, even if this old disk read finishes afterward.
      if (entry.revision !== startedAtRevision) return;
      let preferences: ReaderPreferences | null = raw === null ? defaults() : null;
      let migrated = false;
      if (raw !== null) {
        try {
          const envelope = JSON.parse(raw) as { schemaVersion?: unknown; owner?: unknown; preferences?: unknown } | null;
          if (envelope?.schemaVersion === 1 && envelope.owner === memberId) {
            preferences = normalize(envelope.preferences, true);
            migrated = Boolean(preferences && (envelope.preferences as ReaderPreferences)?.versionId !== preferences.versionId);
          }
        } catch { /* corrupt record: keep a safe default, with a non-sensitive readError flag */ }
      }
      publish(entry, { ...entry.snapshot, ready: true, preferences: preferences ?? defaults(), readError: preferences === null });
      if (migrated && preferences && entry.revision === startedAtRevision) {
        await enqueueSave(memberId, entry, preferences, startedAtRevision);
      }
    })();
    const loading: Promise<void> = task.finally(() => { if (entry.loading === loading) entry.loading = null; });
    entry.loading = loading;
    return loading;
  }

  function enqueueSave(memberId: string, entry: Entry, preferences: ReaderPreferences, revision: number): Promise<void> {
    const payload = JSON.stringify({ schemaVersion: 1, owner: memberId, preferences });
    const operation = entry.writeTail.then(async () => {
      let failed = false;
      try { await storage.setItem(storageKey(memberId), payload); }
      catch { failed = true; }
      // Old completion/failure cannot overwrite the status of a newer optimistic edit.
      if (entry.revision === revision) publish(entry, { ...entry.snapshot, saveError: failed });
    });
    // A rejected subscriber must not wedge future writes; actual I/O errors are already caught above.
    entry.writeTail = operation.catch(() => undefined);
    return operation;
  }

  function update(memberId: string | null, patch: ReaderPreferencesPatch): Promise<void> {
    const entry = entryFor(memberId);
    if (!patch || typeof patch !== 'object') return Promise.reject(new Error('INVALID_READER_PREFERENCES'));
    const preferences = normalize({
      versionId: patch.versionId === undefined ? entry.snapshot.preferences.versionId : patch.versionId,
      settings: patch.settings === undefined ? entry.snapshot.preferences.settings : patch.settings,
    });
    if (!preferences) return Promise.reject(new Error('INVALID_READER_PREFERENCES'));
    if (entry.snapshot.ready && !entry.snapshot.readError && !entry.snapshot.saveError
      && samePreferences(entry.snapshot.preferences, preferences)) return Promise.resolve();
    const revision = ++entry.revision;
    publish(entry, { ready: true, preferences, readError: false, saveError: false });
    if (memberId === null) return Promise.resolve();
    return enqueueSave(memberId, entry, preferences, revision);
  }

  function retrySave(memberId: string | null): Promise<void> {
    const entry = entryFor(memberId);
    if (memberId === null || !entry.snapshot.ready || !entry.snapshot.saveError) return Promise.resolve();
    const { preferences } = entry.snapshot;
    publish(entry, { ...entry.snapshot, saveError: false });
    return enqueueSave(memberId, entry, preferences, entry.revision);
  }

  return {
    getSnapshot: memberId => entryFor(memberId).snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load, update, retrySave,
  };
}
