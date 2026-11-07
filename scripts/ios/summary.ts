// scripts/ios/summary.ts — one PASS/FAIL table and one JSON line; exit 1 on any FAIL.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.env.OUT ?? 'ci-out';
const read = <T>(name: string, fallback: T): T => existsSync(join(out, name)) ? JSON.parse(readFileSync(join(out, name), 'utf8')) as T : fallback;
const haveGuards = existsSync(join(out, 'guards.json'));
const haveFlows = existsSync(join(out, 'flows.json'));
const guards = read('guards.json', { appBytes: 0, guards: {} as Record<string, string[]> });
const flows = read('flows.json', {} as Record<string, string>);
type Runtime = { cpuAvg: number | null; footprintMB: number; idleRequests: number };
const home = read('runtime-home.json', null as null | Runtime);
const reader = read('runtime-reader.json', null as null | Runtime);
// A value that could not be read is a FAIL, never a pass: in JS `null <= 3` is true, and 0 MB means vmmap gave nothing.
const within = (value: number | null | undefined, limit: number) => typeof value === 'number' && value <= limit;
// A flow that passed on its rerun (RERUN-PASS, run-flows.sh) still owes its measurements.
const passed = (flow: string) => /PASS$/.test(flows[flow] ?? '');
const rows: Array<[string, boolean | null, string]> = [];
// When the build or the guards fail, the flows never run: say so instead of a PASS over nothing.
if (!haveGuards) rows.push(['守門 (guards.json)', false, '沒有產生 guards.json']);
else if (!(guards.appBytes > 0)) rows.push(['.app 大小', false, `appBytes ${guards.appBytes}`]);
for (const [id, problems] of Object.entries(guards.guards)) if (problems.length > 0) rows.push([`守門 ${id}`, false, problems.join('；')]);
if (!haveFlows) rows.push(['flows', false, '沒有產生 flows.json']);
else if (Object.keys(flows).length === 0) rows.push(['flows', false, '一個流程都沒有跑']);
for (const [name, result] of Object.entries(flows)) rows.push([`flow ${name}`, result === 'SKIP' ? null : result !== 'FAIL', result]);
if (home) {
  rows.push(['R1 讀經分頁閒置 CPU ≤ 3.0%', within(home.cpuAvg, 3.0), `${home.cpuAvg}%`]);
  rows.push(['R3 記憶體 ≤ 350 MB', home.footprintMB > 0 && within(home.footprintMB, 350), `${home.footprintMB} MB`]);
  rows.push(['R4 閒置請求 = 0', home.idleRequests === 0, String(home.idleRequests)]);
} else if (passed('00-smoke')) rows.push(['R1/R3/R4 首頁量測', false, '沒有產生 runtime-home.json']);
// Skipped (no YouVersion key): the reader showed no text, so a reading of it would not be R2.
if (flows['10-reader-open'] === 'SKIP') rows.push(['R2 讀經器閒置 CPU ≤ 5.0%', null, '讀經器流程略過']);
else if (reader) rows.push(['R2 讀經器閒置 CPU ≤ 5.0%', within(reader.cpuAvg, 5.0), `${reader.cpuAvg}%`]);
else if (passed('10-reader-open')) rows.push(['R2 讀經器量測', false, '沒有產生 runtime-reader.json']);
console.log(rows.map(([name, ok, note]) => `| ${name} | ${ok === null ? '略過' : ok ? 'PASS' : 'FAIL'} | ${note} |`).join('\n'));
const failed = rows.filter(([, ok]) => ok === false).map(([name]) => name);
const summary = { appBytes: guards.appBytes, footprintMB: home?.footprintMB ?? null, guards: guards.guards, flows, runtime: { home, reader }, failed };
writeFileSync(join(out, 'ios-summary.json'), JSON.stringify(summary));
console.log(`\n\`${JSON.stringify({ ios: failed.length === 0 ? 'PASS' : 'FAIL', failed, appMB: +(guards.appBytes / 1e6).toFixed(1), footprintMB: home?.footprintMB ?? null })}\``);
process.exit(failed.length === 0 ? 0 : 1);
