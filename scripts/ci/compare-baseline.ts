// scripts/ci/compare-baseline.ts
// usage: tsx scripts/ci/compare-baseline.ts <current-json> <baseline-json|missing> <field> <maxRatio> <label>
// A PR may not grow a size or memory figure past maxRatio × main's last successful run.
import { existsSync, readFileSync } from 'node:fs';

const [currentPath, baselinePath, field, maxRatio, label] = process.argv.slice(2);
const current = JSON.parse(readFileSync(currentPath, 'utf8')) as Record<string, number>;
if (!baselinePath || !existsSync(baselinePath)) { console.log(`| ${label} | 略過 | main 還沒有基準 |`); process.exit(0); }
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>;
const ratio = current[field] / baseline[field];
const ok = Number.isFinite(ratio) && ratio <= Number(maxRatio);
console.log(`| ${label} | ${ok ? 'PASS' : 'FAIL'} | ${current[field]} vs main ${baseline[field]}（×${ratio.toFixed(3)}，上限 ×${maxRatio}） |`);
process.exit(ok ? 0 : 1);
