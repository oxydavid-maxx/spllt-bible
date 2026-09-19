import { describe, expect, it } from 'vitest';
import { createReaderSpeedStore, DEFAULT_READER_SPEED, isReaderSpeed, READER_SPEEDS, storageKey } from '../../src/services/readerSpeedPreference';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
  };
}

describe('narration speed is remembered, and a bad stored value cannot trap anyone', () => {
  it('offers slower and faster without going so far it stops being scripture read aloud', () => {
    expect(READER_SPEEDS).toEqual([0.75, 1, 1.25, 1.5]);
    expect(DEFAULT_READER_SPEED).toBe(1);
  });

  it('remembers a choice for next time, per member', async () => {
    const storage = memoryStorage();
    const store = createReaderSpeedStore(storage);
    await store.load('member-self');
    expect(store.getSpeed('member-self')).toBe(1);

    await store.update('member-self', 1.25);
    expect(store.getSpeed('member-self')).toBe(1.25);
    expect(storage.values.get(storageKey('member-self'))).toBe('1.25');

    const reopened = createReaderSpeedStore(storage);
    await reopened.load('member-self');
    expect(reopened.getSpeed('member-self')).toBe(1.25);
  });

  it('keeps one member’s choice out of another’s', async () => {
    const storage = memoryStorage();
    const store = createReaderSpeedStore(storage);
    await store.update('member-a', 1.5);
    await store.load('member-b');
    expect(store.getSpeed('member-b')).toBe(1);
  });

  // A speed we later stop offering would otherwise leave someone playing at a rate they cannot
  // see selected in the menu and therefore cannot change.
  it('falls back to normal when the stored value is one we no longer offer', async () => {
    const storage = memoryStorage({ [storageKey('member-self')]: '3' });
    const store = createReaderSpeedStore(storage);
    await store.load('member-self');
    expect(store.getSpeed('member-self')).toBe(1);
  });

  it('falls back to normal when the stored value is not a number at all', async () => {
    const storage = memoryStorage({ [storageKey('member-self')]: 'fast' });
    const store = createReaderSpeedStore(storage);
    await store.load('member-self');
    expect(store.getSpeed('member-self')).toBe(1);
  });

  it('survives storage that throws, because playback matters more than remembering', async () => {
    const store = createReaderSpeedStore({
      getItem: async () => { throw new Error('locked'); },
      setItem: async () => { throw new Error('locked'); },
    });
    await store.load('member-self');
    expect(store.getSpeed('member-self')).toBe(1);
    await store.update('member-self', 1.5);
    expect(store.getSpeed('member-self')).toBe(1.5);
  });

  it('rejects a speed that is not on the menu', () => {
    expect(isReaderSpeed(1.25)).toBe(true);
    expect(isReaderSpeed(2)).toBe(false);
    expect(isReaderSpeed('1.25')).toBe(false);
  });
});
