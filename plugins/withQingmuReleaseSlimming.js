const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Keeps debug source maps out of the shipped app.
 *
 * The reader is an Expo DOM component, so the build emits a web bundle per component and a source
 * map beside each one. Those maps were 66 MB of the packaged assets and exist only to make a
 * JavaScript stack trace readable in a browser's developer tools, which nobody is doing on a
 * student's phone. Compressed they cost about 15 MB of the download, which is still the single
 * largest thing in the app that does nothing for the person installing it.
 *
 * This is a config plugin rather than an edit to android/app/build.gradle because that directory is
 * generated and untracked: an edit there survives until the next prebuild and then quietly comes
 * back as 15 MB nobody notices.
 *
 * The other half of the slimming has no code at all — pass
 * `-ReactNativeArchitectures arm64-v8a,armeabi-v7a` to scripts/build-android.ps1 and the two
 * emulator-only architectures are simply not built. That was 71 MB.
 */

const IGNORE_MARKER = 'ignoreAssetsPattern';
const MAP_RULE = ':!*.map';

module.exports = function withQingmuReleaseSlimming(config) {
  return withAppBuildGradle(config, (mod) => {
    const contents = mod.modResults.contents;
    if (contents.includes(MAP_RULE)) return mod;
    if (!contents.includes(IGNORE_MARKER)) {
      throw new Error('withQingmuReleaseSlimming: no ignoreAssetsPattern to extend; the template changed shape.');
    }
    mod.modResults.contents = contents.replace(
      /(ignoreAssetsPattern\s+'[^']*)'/,
      (_match, existing) => `${existing}${MAP_RULE}'`,
    );
    return mod;
  });
};
