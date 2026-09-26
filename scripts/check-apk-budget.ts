import { readFileSync, statSync } from 'node:fs';
import { checkApkBudget, readZipEntries } from '../src/config/apkBudget';

// usage: tsx scripts/check-apk-budget.ts <apk> <abi[,abi]> <maxMB>
const [apk, abis, maxMb] = process.argv.slice(2);
if (!apk || !abis || !maxMb) {
  console.error('usage: tsx scripts/check-apk-budget.ts <apk> <abi[,abi]> <maxMB>');
  process.exit(2);
}
const problems = checkApkBudget(readZipEntries(readFileSync(apk)), statSync(apk).size, { abis: abis.split(','), maxBytes: Number(maxMb) * 1e6 });
if (problems.length > 0) {
  console.error(`APK budget failed for ${apk}:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`APK budget ok: ${(statSync(apk).size / 1e6).toFixed(1)} MB, ABIs ${abis}, no source maps`);
