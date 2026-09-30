// scripts/ci/compare-baseline.ts
// usage: tsx scripts/ci/compare-baseline.ts <current-json> <baseline-json|missing> <field> <maxRatio> <label> [same-flows]
// A PR may not grow a size or memory figure past maxRatio × main's last successful run.
// same-flows: compare only when both runs ran the same flows. Memory depends on what the app showed before it was
// measured (the reader with or without Bible text), so a baseline from a different set of flows is not comparable.
import { existsSync, readFileSync } from 'node:fs';

type Summary = Record<string, unknown> & { flows?: Record<string, string> };
const [currentPath, baselinePath, field, maxRatio, label, mode] = process.argv.slice(2);
const current = JSON.parse(readFileSync(currentPath, 'utf8')) as Summary;
if (!baselinePath || !existsSync(baselinePath)) { console.log(`| ${label} | 略過 | main 還沒有基準 |`); process.exit(0); }
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Summary;
if (mode === 'same-flows') {
  const ran = (summary: Summary) => Object.entries(summary.flows ?? {}).filter(([, result]) => result !== 'SKIP').map(([name]) => name).sort().join(',');
  if (ran(current) !== ran(baseline)) {
    console.log(`| ${label} | 略過 | 跑的流程和 main 的基準不同，不能直接比；合併後 main 會用這組流程重新記錄基準 |`);
    process.exit(0);
  }
}
const ratio = Number(current[field]) / Number(baseline[field]);
const ok = Number.isFinite(ratio) && ratio <= Number(maxRatio);
console.log(`| ${label} | ${ok ? 'PASS' : 'FAIL'} | ${current[field]} vs main ${baseline[field]}（×${ratio.toFixed(3)}，上限 ×${maxRatio}） |`);
process.exit(ok ? 0 : 1);
