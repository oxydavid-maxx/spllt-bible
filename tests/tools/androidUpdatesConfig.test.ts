import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkAndroidUpdatesConfig, expectedAndroidUpdates } from '../../scripts/android/check-updates-config';

// Shapes copied from a real `expo prebuild --platform android` of this repo (expo-updates 56.0.28).
const meta = (name: string, value: string) => `    <meta-data android:name="expo.modules.updates.${name}" android:value="${value}"/>`;
const productionMeta: Record<string, string> = {
  ENABLED: 'true',
  ENABLE_BSDIFF_PATCH_SUPPORT: 'true',
  EXPO_RUNTIME_VERSION: '@string/expo_runtime_version',
  EXPO_UPDATES_CHECK_ON_LAUNCH: 'ERROR_RECOVERY_ONLY',
  EXPO_UPDATES_LAUNCH_WAIT_MS: '0',
  EXPO_UPDATE_URL: 'https://u.expo.dev/synthetic-project',
  UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: '{&quot;expo-channel-name&quot;:&quot;production&quot;}',
};
const manifest = (overrides: Record<string, string | null> = {}) => {
  const entries = { ...productionMeta, ...overrides };
  return `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application android:name=".MainApplication">\n${Object.entries(entries).filter(([, value]) => value !== null).map(([name, value]) => meta(name, value as string)).join('\n')}\n  </application>\n</manifest>\n`;
};
const strings = (runtime: string | null = '0.5.35') => `<resources>\n  <string name="app_name">竹科聖經</string>\n${runtime === null ? '' : `  <string name="expo_runtime_version">${runtime}</string>\n`}</resources>\n`;
const appJson = { expo: { version: '0.5.35', extra: { eas: { projectId: 'synthetic-project' } } } };
const release = expectedAndroidUpdates(appJson, 'ERROR_RECOVERY_ONLY');

describe('Android native expo-updates configuration (prebuild output)', () => {
  it('derives the expectation from app.json and accepts a fresh production prebuild', () => {
    expect(release).toEqual({ url: 'https://u.expo.dev/synthetic-project', runtimeVersion: '0.5.35', channel: 'production', checkOnLaunch: 'ERROR_RECOVERY_ONLY' });
    expect(checkAndroidUpdatesConfig({ manifest: manifest(), strings: strings() }, release)).toEqual([]);
  });
  it('stops an APK labelled with the new version that still carries the old runtime', () => {
    const problems = checkAndroidUpdatesConfig({ manifest: manifest(), strings: strings('0.5.34') }, release);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('0.5.34'); expect(problems[0]).toContain('0.5.35');
  });
  it('stops an android/ that predates expo-updates (no URL, disabled, no runtime)', () => {
    const stale = manifest({ ENABLED: 'false', EXPO_UPDATES_CHECK_ON_LAUNCH: 'ALWAYS', EXPO_RUNTIME_VERSION: null, EXPO_UPDATE_URL: null, UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: null });
    const problems = checkAndroidUpdatesConfig({ manifest: stale, strings: strings(null) }, release);
    expect(problems.join('\n')).toMatch(/ENABLED/);
    expect(problems.join('\n')).toMatch(/EXPO_UPDATE_URL/);
    expect(problems.join('\n')).toMatch(/runtime/);
    expect(problems.join('\n')).toMatch(/expo-channel-name/);
    expect(problems.join('\n')).toMatch(/CHECK_ON_LAUNCH/);
  });
  it('requires the production channel header, the update URL and a non-blocking launch', () => {
    expect(checkAndroidUpdatesConfig({ manifest: manifest({ UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: '{&quot;expo-channel-name&quot;:&quot;preview&quot;}' }), strings: strings() }, release).join()).toContain('preview');
    expect(checkAndroidUpdatesConfig({ manifest: manifest({ UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY: 'not json' }), strings: strings() }, release)).toHaveLength(1);
    expect(checkAndroidUpdatesConfig({ manifest: manifest({ EXPO_UPDATE_URL: 'https://u.expo.dev/other' }), strings: strings() }, release)).toHaveLength(1);
    expect(checkAndroidUpdatesConfig({ manifest: manifest({ EXPO_UPDATES_LAUNCH_WAIT_MS: '30000' }), strings: strings() }, release)).toHaveLength(1);
  });
  it('keeps the recovery policy: the CI NEVER policy, disabled anti-bricking or no embedded update fail a release', () => {
    expect(checkAndroidUpdatesConfig({ manifest: manifest({ EXPO_UPDATES_CHECK_ON_LAUNCH: 'NEVER' }), strings: strings() }, release).join()).toContain('NEVER');
    expect(checkAndroidUpdatesConfig({ manifest: manifest({ DISABLE_ANTI_BRICKING_MEASURES: 'true' }), strings: strings() }, release)).toHaveLength(1);
    expect(checkAndroidUpdatesConfig({ manifest: manifest({ HAS_EMBEDDED_UPDATE: 'false' }), strings: strings() }, release)).toHaveLength(1);
  });
  it('accepts NEVER only when the isolated CI build asks for it', () => {
    const ci = expectedAndroidUpdates(appJson, 'NEVER');
    expect(checkAndroidUpdatesConfig({ manifest: manifest({ EXPO_UPDATES_CHECK_ON_LAUNCH: 'NEVER' }), strings: strings() }, ci)).toEqual([]);
    expect(checkAndroidUpdatesConfig({ manifest: manifest(), strings: strings() }, ci)).toHaveLength(1);
  });
  it('reads a literal runtime, attributes in any order, and reports missing generated files', () => {
    const literal = manifest().replace('android:value="@string/expo_runtime_version"', 'android:value="0.5.35"');
    expect(checkAndroidUpdatesConfig({ manifest: literal, strings: strings(null) }, release)).toEqual([]);
    const swapped = manifest().replace(/<meta-data android:name="([^"]+)" android:value="([^"]*)"\/>/g, '<meta-data android:value="$2" android:name="$1" />');
    expect(checkAndroidUpdatesConfig({ manifest: swapped, strings: strings() }, release)).toEqual([]);
    expect(checkAndroidUpdatesConfig({ manifest: null, strings: null }, release).join()).toContain('prebuild');
  });

  it('runs on the real prebuild in Android CI, which must embed NEVER before Gradle builds the APK', () => {
    const yml = readFileSync('.github/workflows/android.yml', 'utf8');
    const check = yml.indexOf('npx tsx scripts/android/check-updates-config.ts --check-on-launch NEVER');
    expect(check).toBeGreaterThan(yml.indexOf('npx expo prebuild --platform android --no-install --clean'));
    expect(check).toBeLessThan(yml.indexOf('./gradlew assembleRelease'));
  });

  describe('command line', () => {
    const run = (files: { manifest?: string; strings?: string; app?: object }, args: string[] = []) => {
      const root = mkdtempSync(join(tmpdir(), 'qm-android-updates-'));
      try {
        writeFileSync(join(root, 'app.json'), JSON.stringify(files.app ?? appJson));
        mkdirSync(join(root, 'android/app/src/main/res/values'), { recursive: true });
        if (files.manifest !== undefined) writeFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), files.manifest);
        if (files.strings !== undefined) writeFileSync(join(root, 'android/app/src/main/res/values/strings.xml'), files.strings);
        return spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/android/check-updates-config.ts', '--project', root, ...args], { encoding: 'utf8' });
      } finally { rmSync(root, { recursive: true, force: true }); }
    };
    it('passes a fresh production prebuild and fails a stale one before Gradle', () => {
      const good = run({ manifest: manifest(), strings: strings() });
      expect(good.status, good.stdout + good.stderr).toBe(0);
      const stale = run({ manifest: manifest(), strings: strings('0.5.34') });
      expect(stale.status, stale.stdout + stale.stderr).toBe(1);
      expect(stale.stdout + stale.stderr).toContain('prebuild');
      expect(run({}).status).toBe(1);
    });
    it('checks the CI policy only on request and rejects unknown policies', () => {
      expect(run({ manifest: manifest({ EXPO_UPDATES_CHECK_ON_LAUNCH: 'NEVER' }), strings: strings() }, ['--check-on-launch', 'NEVER']).status).toBe(0);
      expect(run({ manifest: manifest({ EXPO_UPDATES_CHECK_ON_LAUNCH: 'NEVER' }), strings: strings() }).status).toBe(1);
      const unknown = run({ manifest: manifest(), strings: strings() }, ['--check-on-launch', 'ALWAYS']);
      expect(unknown.status).toBe(2); expect(unknown.stderr).toContain('usage');
    });
  });
});
