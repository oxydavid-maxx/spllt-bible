// scripts/ios/summary.ts — one PASS/FAIL table and one JSON line; exit 1 on any FAIL.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.env.OUT ?? 'ci-out';
const read = <T>(name: string, fallback: T): T => existsSync(join(out, name)) ? JSON.parse(readFileSync(join(out, name), 'utf8')) as T : fallback;
const guards = read('guards.json', { appBytes: 0, guards: {} as Record<string, string[]> });
const flows = read('flows.json', {} as Record<string, string>);
const home = read('runtime-home.json', null as null | { cpuAvg: number; footprintMB: number; idleRequests: number });
const reader = read('runtime-reader.json', null as null | { cpuAvg: number; footprintMB: number; idleRequests: number });
const rows: Array<[string, boolean | null, string]> = [];
for (const [name, result] of Object.entries(flows)) rows.push([`flow ${name}`, result === 'SKIP' ? null : result !== 'FAIL', result]);
if (home) {
  rows.push(['R1 讀經分頁閒置 CPU ≤ 3.0%', home.cpuAvg <= 3.0, `${home.cpuAvg}%`]);
  rows.push(['R3 記憶體 ≤ 350 MB', home.footprintMB <= 350, `${home.footprintMB} MB`]);
  rows.push(['R4 閒置請求 = 0', home.idleRequests === 0, String(home.idleRequests)]);
}
if (reader) rows.push(['R2 讀經器閒置 CPU ≤ 5.0%', reader.cpuAvg <= 5.0, `${reader.cpuAvg}%`]);
console.log(rows.map(([name, ok, note]) => `| ${name} | ${ok === null ? '略過' : ok ? 'PASS' : 'FAIL'} | ${note} |`).join('\n'));
const failed = rows.filter(([, ok]) => ok === false).map(([name]) => name);
const summary = { appBytes: guards.appBytes, footprintMB: home?.footprintMB ?? null, guards: guards.guards, flows, runtime: { home, reader }, failed };
writeFileSync(join(out, 'ios-summary.json'), JSON.stringify(summary));
console.log(`\n\`${JSON.stringify({ ios: failed.length === 0 ? 'PASS' : 'FAIL', failed, appMB: +(guards.appBytes / 1e6).toFixed(1), footprintMB: home?.footprintMB ?? null })}\``);
process.exit(failed.length === 0 ? 0 : 1);
