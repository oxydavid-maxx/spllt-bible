import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkApkBudget, checkFirebaseConfig, readZipEntries, readZipEntry } from '../src/config/apkBudget';

// usage: tsx scripts/check-apk-budget.ts <apk> <abi[,abi]> <maxMB>
const [apk, abis, maxMb] = process.argv.slice(2);
if (!apk || !abis || !maxMb) {
  console.error('usage: tsx scripts/check-apk-budget.ts <apk> <abi[,abi]> <maxMB>');
  process.exit(2);
}
const zip = readFileSync(apk);
// The build stages this file (scripts/google-services-boundary.ps1); the APK must have compiled it in.
const servicesPath = join(process.cwd(), 'android', 'app', 'google-services.json');
const appId = existsSync(servicesPath)
  ? (JSON.parse(readFileSync(servicesPath, 'utf8')) as { client?: Array<{ client_info?: { mobilesdk_app_id?: string } }> }).client?.[0]?.client_info?.mobilesdk_app_id ?? null
  : null;
const problems = [
  ...checkApkBudget(readZipEntries(zip), statSync(apk).size, { abis: abis.split(','), maxBytes: Number(maxMb) * 1e6 }),
  ...checkFirebaseConfig(readZipEntry(zip, 'resources.arsc'), appId),
];
if (problems.length > 0) {
  console.error(`APK budget failed for ${apk}:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`APK budget ok: ${(statSync(apk).size / 1e6).toFixed(1)} MB, ABIs ${abis}, no source maps, Firebase config present`);
