import { describe, expect, it } from 'vitest';
import { getYouVersionVersionOptions } from '../../src/config/youVersionContent';
import { createReaderPreferencesStore } from '../../src/services/readerPreferences';
import * as config from '../../src/ui/youVersionReaderConfig';

const ids = [46, 40, 111, 406, 114];
describe('the requested five translations in the real reader', () => {
  it('offers exactly the five requested versions, with Shen CUNP first and real source notices', () => {
    const options = getYouVersionVersionOptions();
    expect(options.map(v => v.versionId)).toEqual(ids);
    expect(options[0].translationName).toMatch(/和合本.*神版/);
    expect(options.map(v => v.languageTag)).toEqual(['zh-Hant-TW', 'zh-Hant-TW', 'en', 'en', 'en']);
    for (const option of options) {
      expect(option.copyrightNotice.trim().length).toBeGreaterThan(15);
      expect(option.officialUrl).toContain(String(option.versionId));
      expect(option.publisher.trim()).not.toBe('');
    }
  });
  it('migrates a removed BSB choice to CUNP while preserving the same member fonts, and persists it', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } };
    const settings = { fontSize: 26, fontFamily: 'Source Serif 4', lineSpacing: 1.8 };
    const old = createReaderPreferencesStore(storage, { allowedVersionIds: [3034], defaultVersionId: 3034 });
    await old.update('A', { versionId: 3034, settings });
    const next = createReaderPreferencesStore(storage, { allowedVersionIds: ids, defaultVersionId: 46, retiredVersionIds: [3034] });
    await next.load('A');
    expect(next.getSnapshot('A')).toMatchObject({ ready: true, readError: false, preferences: { versionId: 46, settings } });
    expect(JSON.parse([...values.values()][0]).preferences).toEqual({ versionId: 46, settings });
    expect(next.getSnapshot('B').preferences).toEqual({ versionId: 46, settings: null });
    await expect(next.update('A', { versionId: 3034 })).rejects.toThrow();
  });
  it('preserves a supported NIV choice and routes the official SDK through the configured HTTPS content adapter', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } };
    const old = createReaderPreferencesStore(storage, { allowedVersionIds: [111, 3034], defaultVersionId: 3034 });
    await old.update('A', { versionId: 111 });
    const next = createReaderPreferencesStore(storage, { allowedVersionIds: ids, defaultVersionId: 46 });
    await next.load('A');
    expect(next.getSnapshot('A').preferences.versionId).toBe(111);
    const resolve = (config as unknown as { resolveReaderContentApiHost: (base?: string) => string | undefined }).resolveReaderContentApiHost;
    expect(resolve('https://api.luminexhealthbiohack.com/')).toBe('api.luminexhealthbiohack.com');
    expect(resolve('https://user:password@wrong.test')).toBeUndefined();
    expect(resolve('https://wrong.test/prefix')).toBeUndefined();
    expect(resolve(undefined)).toBeUndefined();
  });
});
