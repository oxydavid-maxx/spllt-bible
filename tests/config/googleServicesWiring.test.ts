import { readFile } from 'node:fs/promises';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import appConfig from '../../app.config';

describe('Android Google Services wiring', () => {
  it('routes an Android-only services file without requiring an iOS file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qingmu-google-services-'));
    const androidFile = join(root, 'google-services.json');
    await writeFile(androidFile, JSON.stringify({ project_info: { project_id: 'fixture-project' }, client: [{ client_info: { mobilesdk_app_id: '1:123:android:abc', android_client_info: { package_name: 'org.qingmu.youth' } } }] }));
    const previousAndroid = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE;
    const previousIos = process.env.EXPO_PUBLIC_GOOGLE_IOS_SERVICES_FILE;
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE = androidFile;
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_SERVICES_FILE;
    try {
      const result = appConfig({ config: { plugins: ['react-native-nitro-google-signin'] } } as any);
      expect(result.plugins).toContainEqual(['react-native-nitro-google-signin', { androidGoogleServicesFile: androidFile }]);
      expect(result.android.googleServicesFile).toBe(androidFile);
    } finally {
      if (previousAndroid === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE; else process.env.EXPO_PUBLIC_GOOGLE_ANDROID_SERVICES_FILE = previousAndroid;
      if (previousIos === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_SERVICES_FILE; else process.env.EXPO_PUBLIC_GOOGLE_IOS_SERVICES_FILE = previousIos;
    }
  });

  it('has an effective Gradle consumer and build-time file binding', async () => {
    const [rootGradle, appGradle, buildScript, bindingScript] = await Promise.all([
      readFile(join(process.cwd(), 'android', 'build.gradle'), 'utf8'),
      readFile(join(process.cwd(), 'android', 'app', 'build.gradle'), 'utf8'),
      readFile(join(process.cwd(), 'scripts', 'build-android.ps1'), 'utf8'),
      readFile(join(process.cwd(), 'scripts', 'google-services-boundary.ps1'), 'utf8'),
    ]);
    expect(rootGradle).toContain('com.google.gms:google-services');
    expect(appGradle).toContain('com.google.gms.google-services');
    expect(buildScript).toContain('google-services.json');
    expect(bindingScript).toContain('mobilesdk_app_id');
    expect(bindingScript).toContain('project_id');
  });
});
