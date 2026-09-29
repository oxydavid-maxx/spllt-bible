// tests/config/iosConfig.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const expo = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const pluginOptions = (name: string) => (expo.plugins as unknown[]).find((plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === name)?.[1] ?? {};
const CJK = /[\u3400-\u9fff]/;

describe('iOS app config', () => {
  it('keeps the iOS build number in lockstep with the Android versionCode', () => {
    expect(expo.ios.buildNumber).toBe(String(expo.android.versionCode));
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
