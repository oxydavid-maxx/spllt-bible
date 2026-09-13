import { describe, expect, it, vi } from 'vitest';
import { createReaderPreferencesStore, type ReaderPreferencesStorage } from '../../src/services/readerPreferences';

const options = { allowedVersionIds: [46, 1392], defaultVersionId: 46 };
const settings = { fontSize: 24, fontFamily: 'Source Serif 4', lineSpacing: 1.8 };
const record = (owner: string, preferences: unknown) => JSON.stringify({ schemaVersion: 1, owner, preferences });
function memory() {
  const data = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
  };
  return { storage, data };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

describe('reader preferences are account-local, stable and persisted', () => {
  it('uses CUV46 and null settings, with a stable immutable snapshot and a readiness gate', async () => {
    const { storage } = memory();
    const store = createReaderPreferencesStore(storage, options);
    const before = store.getSnapshot('A');
    expect(before).toEqual({ ready: false, preferences: { versionId: 46, settings: null }, readError: false, saveError: false });
    expect(store.getSnapshot('A')).toBe(before);
    expect(Object.isFrozen(before)).toBe(true);
    await store.load('A');
    expect(store.getSnapshot('A').ready).toBe(true);
    const ready = store.getSnapshot('A');
    await store.update('A', { versionId: 46 });
    expect(store.getSnapshot('A')).toBe(ready);
  });

  it('restores the same account after recreating the store, including settings and explicit null reset', async () => {
    const { storage } = memory();
    const first = createReaderPreferencesStore(storage, options);
    await first.update('A', { versionId: 1392, settings });
    const second = createReaderPreferencesStore(storage, options);
    await second.load('A');
    expect(second.getSnapshot('A').preferences).toEqual({ versionId: 1392, settings });
    await second.update('A', { settings: null });
    const third = createReaderPreferencesStore(storage, options);
    await third.load('A');
    expect(third.getSnapshot('A').preferences).toEqual({ versionId: 1392, settings: null });
  });

  it('keeps guest preferences in memory only and never copies account values into guest', async () => {
    const { storage } = memory();
    const store = createReaderPreferencesStore(storage, options);
    await store.load(null);
    await store.update(null, { settings });
    await store.retrySave(null);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(store.getSnapshot(null).ready).toBe(true);
    await store.update('A', { versionId: 1392 });
    expect(store.getSnapshot(null).preferences).toEqual({ versionId: 46, settings });
    expect(createReaderPreferencesStore(storage, options).getSnapshot(null).preferences.settings).toBeNull();
  });

  it('restores different accounts independently, including A/B/A cache identity', async () => {
    const { storage } = memory();
    const store = createReaderPreferencesStore(storage, options);
    await store.update('A', { versionId: 1392, settings });
    await store.update('B', { versionId: 46, settings: { ...settings, fontSize: 18 } });
    const a = store.getSnapshot('A');
    const b = store.getSnapshot('B');
    expect(store.getSnapshot('A')).toBe(a);
    expect(a.preferences.settings?.fontSize).toBe(24);
    expect(b.preferences.settings?.fontSize).toBe(18);
    const restored = createReaderPreferencesStore(storage, options);
    await Promise.all([restored.load('B'), restored.load('A')]);
    expect(restored.getSnapshot('A').preferences).toEqual(a.preferences);
    expect(restored.getSnapshot('B').preferences).toEqual(b.preferences);
  });

  it('makes SecureStore-safe collision-free keys for punctuation and Unicode identities', async () => {
    const { storage, data } = memory();
    const store = createReaderPreferencesStore(storage, options);
    const members = ['a.b', 'a_b', 'a-b', 'é', 'e\u0301', '😀', '\ud83d', ''];
    for (const member of members) await store.update(member, { versionId: 1392 });
    expect(data.size).toBe(members.length);
    for (const key of data.keys()) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('asynchronous reads and writes preserve the most recent explicit choice', () => {
  it('deduplicates an account load and does not let its late record overwrite an explicit update', async () => {
    const read = deferred<string | null>();
    const storage = { getItem: vi.fn(() => read.promise), setItem: vi.fn(async () => {}) };
    const store = createReaderPreferencesStore(storage, options);
    const pending = store.load('A');
    expect(store.load('A')).toBe(pending);
    await store.update('A', { versionId: 46, settings });
    read.resolve(record('A', { versionId: 1392, settings: null }));
    await pending;
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot('A').preferences).toEqual({ versionId: 46, settings });
    expect(store.getSnapshot('A').ready).toBe(true);
  });

  it('handles A/B/A while A loads late without touching the stable B snapshot', async () => {
    const a = deferred<string | null>();
    const b = deferred<string | null>();
    const storage = { getItem: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise), setItem: vi.fn(async () => {}) };
    const store = createReaderPreferencesStore(storage, options);
    const loadA = store.load('A');
    const loadB = store.load('B');
    expect(store.load('A')).toBe(loadA);
    b.resolve(record('B', { versionId: 46, settings: null }));
    await loadB;
    const readyB = store.getSnapshot('B');
    a.resolve(record('A', { versionId: 1392, settings }));
    await loadA;
    expect(store.getSnapshot('B')).toBe(readyB);
    expect(store.getSnapshot('A').preferences.versionId).toBe(1392);
  });

  it('serializes writes for one account so an old write cannot finish last', async () => {
    const writes: { key: string; value: string; gate: ReturnType<typeof deferred<void>> }[] = [];
    const persisted = new Map<string, string>();
    const storage: ReaderPreferencesStorage = {
      getItem: async () => null,
      setItem: (key, value) => {
        const gate = deferred<void>(); writes.push({ key, value, gate });
        return gate.promise.then(() => { persisted.set(key, value); });
      },
    };
    const store = createReaderPreferencesStore(storage, options);
    const first = store.update('A', { versionId: 1392 });
    const second = store.update('A', { versionId: 46, settings });
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    expect(store.getSnapshot('A').preferences).toEqual({ versionId: 46, settings });
    writes[0].gate.resolve(); await first; await Promise.resolve();
    expect(writes).toHaveLength(2);
    writes[1].gate.resolve(); await second;
    expect(JSON.parse(persisted.get(writes[1].key)!).preferences).toEqual({ versionId: 46, settings });
  });

  it('does not let account A block account B writes', async () => {
    const first = deferred<void>();
    const storage = { getItem: async () => null, setItem: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined) };
    const store = createReaderPreferencesStore(storage, options);
    const a = store.update('A', { versionId: 1392 });
    await Promise.resolve();
    await store.update('B', { versionId: 1392 });
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    first.resolve(); await a;
  });

  it('retries the latest failed value and keeps raw storage errors out of snapshots', async () => {
    const { storage } = memory();
    storage.setItem.mockRejectedValueOnce(new Error('PRIVATE_IO_DETAIL')).mockRejectedValueOnce(new Error('PRIVATE_IO_DETAIL'));
    const store = createReaderPreferencesStore(storage, options);
    await store.update('A', { versionId: 1392 });
    expect(store.getSnapshot('A').saveError).toBe(true);
    await store.update('A', { versionId: 46, settings });
    expect(store.getSnapshot('A').saveError).toBe(true);
    await store.retrySave('A');
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1]);
    expect(saved.preferences).toEqual({ versionId: 46, settings });
    expect(store.getSnapshot('A').saveError).toBe(false);
    expect(JSON.stringify(store.getSnapshot('A'))).not.toContain('PRIVATE_IO_DETAIL');
  });

  it('reports a read failure and allows explicit load retry', async () => {
    const storage = { getItem: vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(record('A', { versionId: 1392, settings })), setItem: vi.fn(async () => {}) };
    const store = createReaderPreferencesStore(storage, options);
    await store.load('A');
    expect(store.getSnapshot('A').readError).toBe(true);
    expect(store.getSnapshot('A').ready).toBe(true);
    await store.load('A');
    expect(store.getSnapshot('A').readError).toBe(false);
    expect(store.getSnapshot('A').preferences.versionId).toBe(1392);
  });
});

describe('invalid records fail safely without importing another account', () => {
  it.each([
    '{broken',
    record('B', { versionId: 1392, settings }),
    record('A', { versionId: 9999, settings }),
    record('A', { versionId: 46, settings: { ...settings, fontSize: 0 } }),
    record('A', { versionId: 46, settings: { ...settings, lineSpacing: null } }),
    record('A', { versionId: 46, settings: { ...settings, fontFamily: 'x'.repeat(129) } }),
    record('A', { versionId: 46, settings: { ...settings, fontFamily: 'x\nvalue' } }),
  ])('returns the safe default for invalid persisted data case %#', async raw => {
    const store = createReaderPreferencesStore({ getItem: async () => raw, setItem: async () => {} }, options);
    await store.load('A');
    expect(store.getSnapshot('A')).toEqual({ ready: true, preferences: { versionId: 46, settings: null }, readError: true, saveError: false });
  });

  it('rejects an invalid explicit update without mutating or writing the previous choice', async () => {
    const { storage } = memory();
    const store = createReaderPreferencesStore(storage, options);
    await store.update('A', { versionId: 1392 });
    const before = store.getSnapshot('A');
    await expect(store.update('A', { settings: { ...settings, fontSize: NaN } })).rejects.toThrow('INVALID_READER_PREFERENCES');
    await expect(store.update('A', { versionId: 9999 })).rejects.toThrow('INVALID_READER_PREFERENCES');
    expect(store.getSnapshot('A')).toBe(before);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
});
