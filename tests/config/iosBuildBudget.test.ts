// tests/config/iosBuildBudget.test.ts
import { describe, expect, it } from 'vitest';
import { checkIosAppFiles, checkIosInfoPlist, checkIosPods } from '../../src/config/iosBuildBudget';

describe('iOS build guards', () => {
  const good = { CFBundleIdentifier: 'org.qingmu.youth', CFBundleVersion: '40', UIBackgroundModes: ['audio'], NSCameraUsageDescription: '允許竹科聖經掃描好友 QR 碼' };
  it('accepts the expected bundle, background audio and Chinese purpose strings', () => {
    expect(checkIosInfoPlist(good, { bundleId: 'org.qingmu.youth', buildNumber: '40', requireChineseStrings: ['NSCameraUsageDescription'] })).toEqual([]);
  });
  it('flags a missing audio background mode, a wrong bundle, a stale build number and an English purpose string', () => {
    const problems = checkIosInfoPlist({ ...good, CFBundleIdentifier: 'x', CFBundleVersion: '1', UIBackgroundModes: [], NSCameraUsageDescription: 'Allow camera' },
      { bundleId: 'org.qingmu.youth', buildNumber: '40', requireChineseStrings: ['NSCameraUsageDescription', 'NSFaceIDUsageDescription'] });
    expect(problems).toEqual([
      'CFBundleIdentifier is x, expected org.qingmu.youth',
      'CFBundleVersion is 1, expected 40 (ios.buildNumber must equal android.versionCode)',
      'UIBackgroundModes lacks audio, so chapter narration stops when the app leaves the screen',
      'NSCameraUsageDescription is not written in Chinese',
      'NSFaceIDUsageDescription is missing',
    ]);
  });
  it('rejects shipped source maps and reports the app size', () => {
    expect(checkIosAppFiles([{ path: 'main.jsbundle', bytes: 10 }, { path: 'www.bundle/a.js.map', bytes: 5 }]))
      .toEqual({ appBytes: 15, problems: ['1 source map file(s) shipped, e.g. www.bundle/a.js.map'] });
  });
  it('finds reanimated / worklets pods but not Expo\'s own ExpoModulesWorklets', () => {
    expect(checkIosPods('PODS:\n  - ExpoModulesWorklets (56.0.0)\n  - RNReanimated (4.3.1):\n  - RNWorklets (0.8.3)\n')).toEqual([
      'pod RNReanimated is linked; reanimated / worklets must stay out (react-native.config.js)',
      'pod RNWorklets is linked; reanimated / worklets must stay out (react-native.config.js)',
    ]);
    expect(checkIosPods('PODS:\n  - ExpoModulesWorklets (56.0.0)\n')).toEqual([]);
  });
});
