import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const appConfig = require('../../app.config.js');

afterEach(() => vi.unstubAllEnvs());
describe('iOS Google configuration alongside Android Firebase', () => {
  it('keeps Android services and registers the iOS callback independently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qm-ios-config-'));
    const androidFile = join(dir, 'google-services.json');
    writeFileSync(androidFile, '{}');
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE', androidFile);
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_IOS_SERVICES_FILE', '');
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME', 'com.googleusercontent.apps.synthetic-ios');
    const config = appConfig({ config: { plugins: [], android: { versionCode: 49 }, ios: { bundleIdentifier: 'org.qingmu.youth' } } });
    expect(config.plugins).toContainEqual(['react-native-nitro-google-signin', { androidGoogleServicesFile: androidFile }]);
    expect(config.plugins).toContainEqual(['./plugins/withGoogleIosUrlScheme', { iosUrlScheme: 'com.googleusercontent.apps.synthetic-ios' }]);
    const { compileModsAsync, withPlugins } = require('@expo/config-plugins');
    const applied = withPlugins({ name: 'test', slug: 'test', ios: {}, _internal: { projectRoot: dir } }, [[require('../../plugins/withGoogleIosUrlScheme'), { iosUrlScheme: 'com.googleusercontent.apps.synthetic-ios' }]]);
    const compiled = await compileModsAsync(applied, { projectRoot: dir, platforms: ['ios'], introspect: true });
    expect(compiled._internal.modResults.ios.infoPlist.CFBundleURLTypes).toContainEqual({ CFBundleURLSchemes: ['com.googleusercontent.apps.synthetic-ios'] });
  });
});
