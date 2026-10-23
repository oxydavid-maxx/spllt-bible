// scripts/ios/compare-footprints.ts <current ios-summary.json> <main ios-summary.json>
// R3 vs main for every page whose memory the run measures (2026-10-23): 首頁, 讀經頁 and 積分頁 may not grow past
// 1.10 × main's last successful run. Memory depends on what the app showed before it was measured, so a page is
// compared only when both runs ran the same flows up to its measuring point (run-flows.sh: 首頁 after 00-smoke, 讀經頁
// after 10-reader-open, 積分頁 after 44-points-instant); flows added later in the run do not take the guard away.
// A figure this run did not measure FAILs. A page main has never measured is 略過 until main records it.
import { existsSync, readFileSync } from 'node:fs';

export const MAX_RATIO = 1.10;
type Summary = Record<string, unknown> & { flows?: Record<string, string>; runtime?: Record<string, { footprintMB?: unknown } | null | undefined> };
export interface Page { label: string; field: string; runtime: string; after: string }
export const PAGES: Page[] = [
  { label: '首頁', field: 'footprintMB', runtime: 'home', after: '00-smoke' },
  { label: '讀經頁', field: 'footprintReaderMB', runtime: 'reader', after: '10-reader-open' },
  { label: '積分頁', field: 'footprintProgressMB', runtime: 'progress', after: '44-points-instant' },
];
export interface Row { label: string; result: 'PASS' | 'FAIL' | 'SKIP'; note: string }

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const footprintOf = (summary: Summary, page: Page): number | null => {
  const value = summary[page.field] ?? summary.runtime?.[page.runtime]?.footprintMB;
  return positive(value) ? value : null;
};
const flowsUpTo = (summary: Summary, flow: string) => Object.entries(summary.flows ?? {})
  .filter(([name, result]) => name <= flow && result !== 'SKIP').map(([name]) => name).sort().join(',');

export function compareFootprints(current: Summary, baseline: Summary | null): Row[] {
  return PAGES.map((page) => {
    const label = `R3 ${page.label}記憶體 vs main`;
    const now = footprintOf(current, page);
    if (now === null) return { label, result: 'FAIL', note: '這次沒有量到 (不能用缺值或 0)' };
    if (!baseline) return { label, result: 'SKIP', note: `${now} MB；main 還沒有基準` };
    const main = footprintOf(baseline, page);
    if (main === null) return { label, result: 'SKIP', note: `${now} MB；main 還沒有量這一頁，合併後 main 開始記錄` };
    if (flowsUpTo(current, page.after) !== flowsUpTo(baseline, page.after)) return { label, result: 'SKIP', note: `${now} MB；量之前跑的流程和 main 不同，不能直接比` };
    const ratio = now / main;
    return { label, result: ratio <= MAX_RATIO ? 'PASS' : 'FAIL', note: `${now} vs main ${main} MB (×${ratio.toFixed(3)}，上限 ×${MAX_RATIO.toFixed(2)})` };
  });
}

if (process.argv[1]?.endsWith('compare-footprints.ts')) {
  const [currentPath, baselinePath] = process.argv.slice(2);
  const read = (path: string | undefined) => { try { return path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Summary : null; } catch { return null; } };
  const rows = compareFootprints(read(currentPath) ?? {}, read(baselinePath));
  for (const row of rows) console.log(`| ${row.label} | ${row.result === 'SKIP' ? '略過' : row.result} | ${row.note} |`);
  process.exit(rows.some((row) => row.result === 'FAIL') ? 1 : 0);
}
