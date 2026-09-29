// tests/config/iosConfig.test.ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const expo = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const pluginOptions = (name: string) => (expo.plugins as unknown[]).find((plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === name)?.[1] ?? {};
const CJK = /[\u3400-\u9fff]/;

describe('iOS app config', () => {
  it('derives the iOS build number from the Android versionCode, so a release bumps one number', () => {
    // app.json holds only versionCode; app.config.js copies it. A second hand-kept number would drift the
    // first time a release bumped one and not the other.
    expect(expo.ios.buildNumber).toBeUndefined();
    const resolve = require('../../app.config.js') as (context: { config: typeof expo }) => { ios: { buildNumber: string }; android: { versionCode: number } };
    const resolved = resolve({ config: { ...expo, plugins: [...expo.plugins] } });
    expect(resolved.ios.buildNumber).toBe(String(expo.android.versionCode));
    expect(resolve({ config: { ...expo, plugins: [], android: { ...expo.android, versionCode: 57 } } }).ios.buildNumber).toBe('57');
  });
  it('is an iPhone app that declares no non-exempt encryption', () => {
    expect(expo.ios.supportsTablet).toBe(false);
    expect(expo.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });
  it('writes every iOS purpose string in Chinese instead of the plugins\' English defaults', () => {
    expect(pluginOptions('expo-camera').cameraPermission).toMatch(CJK);
    expect(pluginOptions('expo-camera').microphonePermission).toMatch(CJK);
    expect(pluginOptions('expo-audio').microphonePermission).toMatch(CJK);
    expect(pluginOptions('expo-local-authentication').faceIDPermission).toMatch(CJK);
    expect(pluginOptions('expo-secure-store').faceIDPermission).toBe(pluginOptions('expo-local-authentication').faceIDPermission);
  });
});
