import { describe, expect, it, vi } from 'vitest';
import { createReaderAutoplayPreferencesStore } from '../../src/services/readerAutoplayPreferences';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(ok => { resolve = ok; });
  return { promise, resolve };
}

describe('reader autoplay preferences', () => {
  it('defaults to enabled, persists per account, and keeps accounts isolated', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: vi.fn(async (key: string) => data.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    };
    const store = createReaderAutoplayPreferencesStore(storage);
    expect(store.getSnapshot('A').preferences.enabled).toBe(true);
    await store.load('A');
    await store.update('A', false);
    await store.load('B');
    expect(store.getSnapshot('A').preferences.enabled).toBe(false);
    expect(store.getSnapshot('B').preferences.enabled).toBe(true);

    const restored = createReaderAutoplayPreferencesStore(storage);
    await restored.load('A');
    expect(restored.getSnapshot('A').preferences.enabled).toBe(false);
    expect([...data.keys()]).toEqual(['qingmu.reader.autoplay.v1.m-41']);
  });

  it('does not let a late old account read overwrite a newer explicit preference', async () => {
    const read = deferred<string | null>();
    const storage = { getItem: vi.fn(() => read.promise), setItem: vi.fn(async () => {}) };
    const store = createReaderAutoplayPreferencesStore(storage);
    const loading = store.load('A');
    await store.update('A', false);
    read.resolve(JSON.stringify({ schemaVersion: 1, owner: 'A', preferences: { enabled: true } }));
    await loading;
    expect(store.getSnapshot('A').preferences.enabled).toBe(false);
  });

  it('reports transport failure separately while retaining the intended value for retry', async () => {
    const storage = { getItem: vi.fn(async () => null), setItem: vi.fn().mockRejectedValueOnce(new Error('private')) };
    const store = createReaderAutoplayPreferencesStore(storage);
    await store.update('A', false);
    expect(store.getSnapshot('A')).toMatchObject({ ready: true, preferences: { enabled: false }, saveError: true });
  });
});
