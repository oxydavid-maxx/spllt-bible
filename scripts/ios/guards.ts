// scripts/ios/guards.ts — I2 (no reanimated/worklets), I3 (Info.plist), I4 (.app contents). macOS only.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkLeanReaderSheets } from '../../src/config/apkBudget';
import { checkIosAppFiles, checkIosInfoPlist, checkIosPods } from '../../src/config/iosBuildBudget';

const out = process.env.OUT ?? 'ci-out';
const app = readFileSync(join(out, 'app-path.txt'), 'utf8').trim();
const appJson = JSON.parse(readFileSync('app.json', 'utf8')) as { expo: { android: { versionCode: number }; ios: { bundleIdentifier: string; buildNumber?: string } } };
const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')], { encoding: 'utf8' })) as Record<string, unknown>;
const walk = (dir: string): Array<{ path: string; bytes: number }> => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [{ path: relative(app, full), bytes: statSync(full).size }];
});
const files = checkIosAppFiles(walk(app));
const executable = join(app, String(plist.CFBundleExecutable));
const symbols = execFileSync('nm', ['-U', executable], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const nativeClasses = symbols.split('\n').filter((line) => /OBJC_CLASS_\$_(ReanimatedModule|REANodesManager|WorkletsModule)$/.test(line)).length;
const guards = {
  I2: [...checkIosPods(readFileSync('ios/Podfile.lock', 'utf8')),
    ...(nativeClasses > 0 ? [`${nativeClasses} reanimated / worklets native classes linked`] : []),
    ...checkLeanReaderSheets([], readFileSync(join(app, 'main.jsbundle')))],
  I3: checkIosInfoPlist(plist, {
    bundleId: appJson.expo.ios.bundleIdentifier,
    buildNumber: appJson.expo.ios.buildNumber,
    requireChineseStrings: (process.env.IOS_REQUIRED_CHINESE_STRINGS ?? 'NSCameraUsageDescription').split(',').filter(Boolean),
  }),
  I4: files.problems,
};
// Recorded, not judged: what App Transport Security allows decides whether the CI fixture backend (http://127.0.0.1) is reachable.
writeFileSync(join(out, 'guards.json'), JSON.stringify({ appBytes: files.appBytes, guards, ats: plist.NSAppTransportSecurity ?? null }));
const rows = Object.entries(guards).map(([id, problems]) => `| ${id} | ${problems.length === 0 ? 'PASS' : 'FAIL'} | ${problems.join('；')} |`);
console.log([...rows, `| .app 大小 | 資訊 | ${(files.appBytes / 1e6).toFixed(1)} MB |`].join('\n'));
process.exit(Object.values(guards).every((problems) => problems.length === 0) ? 0 : 1);
