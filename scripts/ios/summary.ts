// scripts/ios/summary.ts — one PASS/FAIL table and one JSON line; exit 1 on any FAIL.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.env.OUT ?? 'ci-out';
const read = <T>(name: string, fallback: T): T => existsSync(join(out, name)) ? JSON.parse(readFileSync(join(out, name), 'utf8')) as T : fallback;
const guards = read('guards.json', { appBytes: 0, guards: {} as Record<string, string[]> });
const flows = read('flows.json', {} as Record<string, string>);
type Runtime = { cpuAvg: number | null; footprintMB: number; idleRequests: number };
const home = read('runtime-home.json', null as null | Runtime);
const reader = read('runtime-reader.json', null as null | Runtime);
const progress = read('runtime-progress.json', null as null | { footprintMB: number });
// R6 (光佑 2026-10-23): each switch's tap-to-content time, from scripts/ios/check-switch-latency.ts.
const latency = read('switch-latency.json', null as null | { limitMs: number; rows: Array<{ flow: string; name: string; tap: string; ms: number | null; result: 'PASS' | 'FAIL' | 'SKIP' }> });
// A value that could not be read is a FAIL, never a pass: in JS `null <= 3` is true, and 0 MB means vmmap gave nothing.
const within = (value: number | null | undefined, limit: number) => typeof value === 'number' && value <= limit;
const rows: Array<[string, boolean | null, string]> = [];
for (const [name, result] of Object.entries(flows)) rows.push([`flow ${name}`, result === 'SKIP' ? null : result !== 'FAIL', result]);
if (home) {
  rows.push(['R1 讀經分頁閒置 CPU ≤ 3.0%', within(home.cpuAvg, 3.0), `${home.cpuAvg}%`]);
  rows.push(['R3 記憶體 ≤ 350 MB', home.footprintMB > 0 && within(home.footprintMB, 350), `${home.footprintMB} MB`]);
  rows.push(['R4 閒置請求 = 0', home.idleRequests === 0, String(home.idleRequests)]);
} else if (flows['00-smoke'] === 'PASS') rows.push(['R1/R3/R4 首頁量測', false, '沒有產生 runtime-home.json']);
if (reader) rows.push(['R2 讀經器閒置 CPU ≤ 5.0%', within(reader.cpuAvg, 5.0), `${reader.cpuAvg}%`]);
else if (flows['10-reader-open'] === 'PASS') rows.push(['R2 讀經器量測', false, '沒有產生 runtime-reader.json']);
// R3 on the reader and 積分 pages too (2026-10-23): the same 350 MB as 首頁.
if (reader) rows.push(['R3 讀經頁記憶體 ≤ 350 MB', reader.footprintMB > 0 && within(reader.footprintMB, 350), `${reader.footprintMB} MB`]);
if (progress) rows.push(['R3 積分頁記憶體 ≤ 350 MB', progress.footprintMB > 0 && within(progress.footprintMB, 350), `${progress.footprintMB} MB`]);
else if ('15-points-instant' in flows) rows.push(['R3 積分頁記憶體', false, '沒有產生 runtime-progress.json']);
if (latency) for (const row of latency.rows) rows.push([`R6 切換 ≤ ${latency.limitMs} ms：${row.name} ${row.tap}`, row.result === 'SKIP' ? null : row.result === 'PASS', row.ms === null ? '沒量到' : `${row.ms} ms`]);
else if ('15-points-instant' in flows) rows.push(['R6 切換延遲', false, '沒有產生 switch-latency.json']);
console.log(rows.map(([name, ok, note]) => `| ${name} | ${ok === null ? '略過' : ok ? 'PASS' : 'FAIL'} | ${note} |`).join('\n'));
const failed = rows.filter(([, ok]) => ok === false).map(([name]) => name);
const summary = { appBytes: guards.appBytes, footprintMB: home?.footprintMB ?? null, footprintReaderMB: reader?.footprintMB ?? null, footprintProgressMB: progress?.footprintMB ?? null, guards: guards.guards, flows, runtime: { home, reader, progress }, switchLatency: latency?.rows ?? null, failed };
writeFileSync(join(out, 'ios-summary.json'), JSON.stringify(summary));
console.log(`\n\`${JSON.stringify({ ios: failed.length === 0 ? 'PASS' : 'FAIL', failed, appMB: +(guards.appBytes / 1e6).toFixed(1), footprintMB: home?.footprintMB ?? null })}\``);
process.exit(failed.length === 0 ? 0 : 1);
