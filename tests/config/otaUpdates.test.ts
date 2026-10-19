import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const expo = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const resolve = require('../../app.config.js');
afterEach(() => vi.unstubAllEnvs());

describe('EAS Update native startup configuration', () => {
  it('embeds production for local Gradle and EAS builds without changing the release version', () => {
    const result = resolve({ config: expo });
    expect(result.updates).toMatchObject({
      enabled: true,
      url: 'https://u.expo.dev/2aa0b072-2f45-4e8c-a2bf-9d6f4c1e0887',
      requestHeaders: { 'expo-channel-name': 'production' },
      checkAutomatically: 'ON_ERROR_RECOVERY',
      fallbackToCacheTimeout: 0,
      disableAntiBrickingMeasures: false,
      useEmbeddedUpdate: true,
    });
    expect(result.runtimeVersion).toEqual({ policy: 'appVersion' });
    expect(result.extra.otaCheckEnabled).toBeUndefined();
    expect(result.version).toBe(expo.version);
    expect(result.android.versionCode).toBe(expo.android.versionCode);
    const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
    expect(eas.build.production.channel).toBe('production');
    expect(eas.build.preview.channel).toBe('preview');
  });

  it('permits explicitly isolated CI to skip checks while keeping the native switch API enabled', () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('QINGMU_CI_DISABLE_OTA_CHECKS', '1');
    expect(resolve({ config: expo }).updates).toMatchObject({ enabled: true, checkAutomatically: 'NEVER' });
    expect(resolve({ config: expo }).extra.otaCheckEnabled).toBeUndefined();
  });

  it.each(['production', 'preview'])('never disables an EAS %s build even with the CI switch inherited', (profile) => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('QINGMU_CI_DISABLE_OTA_CHECKS', '1');
    vi.stubEnv('EAS_BUILD_PROFILE', profile);
    expect(resolve({ config: expo }).updates.enabled).toBe(true);
    expect(resolve({ config: expo }).updates.checkAutomatically).toBe('ON_ERROR_RECOVERY');
  });

  it('ignores the CI switch in a normal local release', () => {
    vi.stubEnv('CI', 'false');
    vi.stubEnv('QINGMU_CI_DISABLE_OTA_CHECKS', '1');
    expect(resolve({ config: expo }).updates.enabled).toBe(true);
    expect(resolve({ config: expo }).updates.checkAutomatically).toBe('ON_ERROR_RECOVERY');
  });

  it('forces checks on for the signed local Gradle release even if both CI flags leak into it', () => {
    vi.stubEnv('CI', 'true'); vi.stubEnv('QINGMU_CI_DISABLE_OTA_CHECKS', '1');
    vi.stubEnv('QINGMU_RELEASE_SIGNING_PROPERTIES', 'synthetic-signing-file-not-opened');
    expect(resolve({ config: expo }).updates.checkAutomatically).toBe('ON_ERROR_RECOVERY');
  });

  it('keeps EAS checks enabled without a profile and embeds the preview header in preview builds', () => {
    vi.stubEnv('CI', 'true'); vi.stubEnv('QINGMU_CI_DISABLE_OTA_CHECKS', '1'); vi.stubEnv('EAS_BUILD', 'true');
    expect(resolve({ config: expo }).updates.checkAutomatically).toBe('ON_ERROR_RECOVERY');
    vi.stubEnv('EAS_BUILD_PROFILE', 'preview');
    expect(resolve({ config: expo }).updates.requestHeaders).toEqual({ 'expo-channel-name': 'preview' });
  });

  // One preview group holds two separately running updates. Pushing both after a check on one phone would send
  // the platform nobody opened to everyone, so promotion names the accepted platform.
  it('documents production promotion per accepted platform, never both at once', () => {
    const doc = readFileSync('docs/eas-update.md', 'utf8');
    const publish = doc.slice(doc.indexOf('## 發送流程'), doc.indexOf('## 回復'));
    const promotions = publish.split('\n').filter((line) => /update:republish .*--destination-channel production/.test(line));
    expect(promotions.map((line) => line.match(/--platform (\S+)/)?.[1]).sort()).toEqual(['android', 'ios']);
    expect(publish).toMatch(/Android.*iPhone|iPhone.*Android/);
  });

  // #71 and this PR both rewrote the same RootLayout line. Taking either side alone passes every other
  // test: one drops the OTA owner, the other silently drops #71's splash/hydrating gate (sign-in flash).
  it('keeps #71\'s hydrating gate and the OTA owner outside it in RootLayout', () => {
    const root = readFileSync('app/_layout.tsx', 'utf8');
    const returned = root.slice(root.lastIndexOf('return <GestureHandlerRootView'));
    expect(returned).toContain('<AppStack signedIn={signedIn} hydrating={hydrating} />');
    expect(returned).toContain('{!hydrating && <><CongregationGate /><UpdatePrompt /></>}');
    const gate = returned.indexOf('{!hydrating &&');
    expect(returned.indexOf('<OtaUpdateCheck />')).toBeGreaterThan(-1);
    expect(returned.indexOf('<OtaUpdateCheck />')).toBeLessThan(gate);
    expect(returned.slice(gate)).not.toContain('<OtaUpdateCheck />');
  });

  it('wires a single non-blocking startup owner and never uses URL overrides or forced reloads', () => {
    const root = readFileSync('app/_layout.tsx', 'utf8');
    expect(root.match(/<OtaUpdateCheck\s*\/>/g)).toHaveLength(1);
    const source = readFileSync('src/ui/admin/OtaUpdates.tsx', 'utf8');
    expect(source).not.toMatch(/Updates\.(reloadAsync|setUpdateURLAndRequestHeadersOverride)\s*\(/);
    expect(source).not.toMatch(/setInterval\s*\(|AppState\.addEventListener/);
    for (const workflow of ['android', 'ios']) expect(readFileSync(`.github/workflows/${workflow}.yml`, 'utf8')).toContain("QINGMU_CI_DISABLE_OTA_CHECKS: '1'");
  });
});
