import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileModsAsync } from '@expo/config-plugins';
import { getPrebuildConfigAsync } from '@expo/prebuild-config';
import { NOTIFICATION_ICON } from 'expo-notifications/plugin/build/withNotificationsAndroid';
import { readPng } from '../helpers/readPng';

// 光佑 2026-09-28: chapter narration plays in the background with a media card. None of that reaches a
// phone unless the config the build compiles says so: expo-audio's config plugin was never listed, so
// the APK had no playback service and no FOREGROUND_SERVICE_MEDIA_PLAYBACK, and Android paused the
// reading the moment the app left the screen. This compiles the real app config (every plugin, in
// order, including this repo's permission floor) the way `expo config --type introspect` does.

type Named = { $: Record<string, string> } & Record<string, unknown>;


async function compiledAndroidManifest() {
  const root = process.cwd();
  const { exp } = await getPrebuildConfigAsync(root, { platforms: ['android'] });
  const compiled = await compileModsAsync(exp, { projectRoot: root, introspect: true, platforms: ['android'], assertMissingModProviders: false });
  const manifest = (compiled as unknown as { _internal: { modResults: { android: { manifest: { manifest: Record<string, any> } } } } })
    ._internal.modResults.android.manifest.manifest;
  const application = manifest.application[0] as Record<string, Named[]>;
  return {
    permissions: (manifest['uses-permission'] as Named[]).filter(entry => entry.$['tools:node'] !== 'remove').map(entry => entry.$['android:name']),
    services: application.service ?? [],
    metaData: Object.fromEntries((application['meta-data'] ?? []).map(entry => [entry.$['android:name'], entry.$['android:resource'] ?? entry.$['android:value']])),
  };
}

describe('background chapter audio reaches the Android build', () => {
  it('declares the media playback service and its foreground-service permissions, and still no microphone', async () => {
    const { permissions, services } = await compiledAndroidManifest();
    const playback = services.find(service => service.$['android:name'] === 'expo.modules.audio.service.AudioControlsService');
    expect(playback?.$).toEqual({
      'android:name': 'expo.modules.audio.service.AudioControlsService',
      'android:exported': 'false',
      'android:foregroundServiceType': 'mediaPlayback',
    });
    expect(JSON.stringify(playback?.['intent-filter'])).toContain('androidx.media3.session.MediaSessionService');
    expect(permissions).toEqual(expect.arrayContaining(['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK']));
    // Reading aloud never records: expo-audio would add RECORD_AUDIO by default, and this app must not ask for it.
    expect(permissions).not.toContain('android.permission.RECORD_AUDIO');
    expect(services.map(service => service.$['android:name'])).not.toContain('expo.modules.audio.service.AudioRecordingService');
  }, 60_000);

  it("gives every notification the app's own monochrome mark, so friend pushes and the media card share it", async () => {
    const { metaData } = await compiledAndroidManifest();
    // NOTIFICATION_ICON is the drawable the expo-notifications plugin generates; the expo-audio patch
    // (patches/expo-audio+56.0.13.patch) resolves the media card's status-bar icon by the same name.
    expect(metaData['expo.modules.notifications.default_notification_icon']).toBe(`@drawable/${NOTIFICATION_ICON}`);
    expect(metaData['com.google.firebase.messaging.default_notification_icon']).toBe(`@drawable/${NOTIFICATION_ICON}`);
    const plugins = JSON.parse(readFileSync('app.json', 'utf8')).expo.plugins as unknown[];
    const notifications = plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-notifications') as [string, { icon: string }];
    // Android draws a status-bar icon from its alpha alone: anything not white-on-transparent turns into a blob.
    const icon = readPng(readFileSync(notifications[1].icon));
    let visible = 0;
    for (let at = 0; at < icon.data.length; at += 4) {
      if (icon.data[at + 3] === 0) continue;
      visible += 1;
      expect([icon.data[at], icon.data[at + 1], icon.data[at + 2]]).toEqual([255, 255, 255]);
    }
    expect(icon.width).toBe(icon.height);
    expect(visible / (icon.width * icon.height)).toBeGreaterThan(0.2);
    expect(visible / (icon.width * icon.height)).toBeLessThan(0.8);
  }, 60_000);
});

describe('the media card artwork (assets/media-artwork.png)', () => {
  // 光佑 asked to watch memory: the card's artwork is decoded into full bitmaps by the playback service,
  // media3 and the system UI. The 1024 x 1024 app icon is 4 MB per decoded copy; the card shows it at most
  // about 256 dp, so a 512 x 512 copy is sharp there at a quarter of the memory.
  it('is the app icon itself at 512 x 512, not a redrawn mark', () => {
    const icon = readPng(readFileSync('assets/icon.png'));
    const artwork = readPng(readFileSync('assets/media-artwork.png'));
    expect([artwork.width, artwork.height]).toEqual([512, 512]);
    expect([icon.width, icon.height]).toEqual([1024, 1024]);
    let difference = 0;
    for (let y = 0; y < 512; y += 1) {
      for (let x = 0; x < 512; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          const source = [0, 1].flatMap(dy => [0, 1].map(dx => icon.data[((2 * y + dy) * 1024 + 2 * x + dx) * 4 + channel]));
          difference += Math.abs(artwork.data[(y * 512 + x) * 4 + channel] - source.reduce((sum, value) => sum + value, 0) / 4);
        }
      }
    }
    // Mean per-channel difference from a plain 2 x 2 average of the icon: a resample, not another picture.
    expect(difference / (512 * 512 * 3)).toBeLessThan(2);
  });
});

describe("the media card's status-bar icon (patches/expo-audio+56.0.13.patch)", () => {
  // A Windows checkout may hold the patch with CRLF; patch-package accepts either.
  const patch = () => readFileSync('patches/expo-audio+56.0.13.patch', 'utf8').replace(/\r\n/g, '\n');

  it("replaces media3's generic play glyph at both notification builders with the app's mark, keeping the glyph as fallback", () => {
    const text = patch();
    expect(text).toContain('+++ b/node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/AudioControlsService.kt');
    expect(text.match(/^-\s+\.setSmallIcon\(androidx\.media3\.session\.R\.drawable\.media3_icon_circular_play\)$/gm)).toHaveLength(2);
    expect(text.match(/^\+\s+\.setSmallIcon\(smallIcon\)$/gm)).toHaveLength(2);
    expect(text).toContain(`+    resources.getIdentifier("${NOTIFICATION_ICON}", "drawable", packageName).takeIf { it != 0 }`);
    expect(text).toContain('+      ?: androidx.media3.session.R.drawable.media3_icon_circular_play');
  });

  it('compiles expo-audio from source, because the prebuilt AAR it ships would silently ignore the patch', () => {
    // expo-modules-autolinking links a module that declares a publication from its local-maven-repo AAR
    // (SettingsManager.kt, configurePublication) unless the app lists it under buildFromSource.
    const moduleConfig = JSON.parse(readFileSync('node_modules/expo-audio/expo-module.config.json', 'utf8'));
    expect(moduleConfig.android.publication.repository).toBe('local-maven-repo');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.expo.autolinking.android.buildFromSource).toContain('expo-audio');
  });
});
