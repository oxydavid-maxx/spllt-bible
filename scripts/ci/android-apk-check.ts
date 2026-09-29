// scripts/ci/android-apk-check.ts
// usage: tsx scripts/ci/android-apk-check.ts <apk> <abis> <maxMB> <out-json> <nativeDiffLines>
// The release check (scripts/check-apk-budget.ts) also needs the private google-services.json, which never
// leaves 光佑's machine; every other release check runs here unchanged.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { checkApkBudget, checkBackgroundAudioManifest, checkLeanReaderSheets, readZipEntries, readZipEntry } from '../../src/config/apkBudget';

const [apk, abis, maxMb, output, nativeDiff] = process.argv.slice(2);
if (!apk || !abis || !maxMb || !output) { console.error('usage: tsx scripts/ci/android-apk-check.ts <apk> <abis> <maxMB> <out-json> <nativeDiffLines>'); process.exit(2); }
const zip = readFileSync(apk);
const apkBytes = statSync(apk).size;
const problems = [
  ...checkApkBudget(readZipEntries(zip), apkBytes, { abis: abis.split(','), maxBytes: Number(maxMb) * 1e6 }),
  ...checkBackgroundAudioManifest(readZipEntry(zip, 'AndroidManifest.xml')),
  ...checkLeanReaderSheets(readZipEntries(zip), readZipEntry(zip, 'assets/index.android.bundle')),
];
const summary = { apkBytes, abis, problems, nativeDiffLines: Number(nativeDiff ?? 0) };
writeFileSync(output, JSON.stringify(summary));
const row = (name: string, ok: boolean, note = '') => `| ${name} | ${ok ? 'PASS' : 'FAIL'} | ${note} |`;
console.log(['| 守門 | 結果 | 備註 |', '|---|---|---|',
  row('ABI／大小／source map／背景播放／無 reanimated', problems.length === 0, `${(apkBytes / 1e6).toFixed(1)} MB`),
  '| Firebase 設定 | 略過 | 私有檔不上雲端；正式候選在本機驗 |',
  `| Android 原生設定 diff（vs main） | 資訊 | ${summary.nativeDiffLines} 行不同 |`].join('\n'));
for (const problem of problems) console.log(`- FAIL ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
