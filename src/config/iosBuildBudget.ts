// src/config/iosBuildBudget.ts
/**
 * iOS counterparts of the APK checks in apkBudget.ts, as pure functions so vitest can run them
 * anywhere; scripts/ios/guards.ts feeds them the built .app on the macOS runner.
 */
export interface IosPlistExpectation { bundleId: string; buildNumber?: string; requireChineseStrings: string[] }

const CJK = /[\u3400-\u9fff]/;

export function checkIosInfoPlist(plist: Record<string, unknown>, expected: IosPlistExpectation): string[] {
  const problems: string[] = [];
  if (plist.CFBundleIdentifier !== expected.bundleId) problems.push(`CFBundleIdentifier is ${String(plist.CFBundleIdentifier)}, expected ${expected.bundleId}`);
  if (expected.buildNumber !== undefined && plist.CFBundleVersion !== expected.buildNumber) {
    problems.push(`CFBundleVersion is ${String(plist.CFBundleVersion)}, expected ${expected.buildNumber} (ios.buildNumber must equal android.versionCode)`);
  }
  const modes = Array.isArray(plist.UIBackgroundModes) ? plist.UIBackgroundModes : [];
  if (!modes.includes('audio')) problems.push('UIBackgroundModes lacks audio, so chapter narration stops when the app leaves the screen');
  for (const key of expected.requireChineseStrings) {
    const value = plist[key];
    if (typeof value !== 'string') problems.push(`${key} is missing`);
    else if (!CJK.test(value)) problems.push(`${key} is not written in Chinese`);
  }
  return problems;
}

export function checkIosAppFiles(files: Array<{ path: string; bytes: number }>): { appBytes: number; problems: string[] } {
  const maps = files.filter((file) => file.path.endsWith('.map'));
  return {
    appBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    problems: maps.length > 0 ? [`${maps.length} source map file(s) shipped, e.g. ${maps[0].path}`] : [],
  };
}

export function checkIosPods(podfileLock: string): string[] {
  return ['RNReanimated', 'RNWorklets']
    .filter((pod) => new RegExp(`^  - ${pod}[ (:]`, 'm').test(podfileLock))
    .map((pod) => `pod ${pod} is linked; reanimated / worklets must stay out (react-native.config.js)`);
}
