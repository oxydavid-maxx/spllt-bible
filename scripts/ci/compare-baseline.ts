// scripts/ci/compare-baseline.ts
// usage: tsx scripts/ci/compare-baseline.ts <current-json> <baseline-json|missing> <field> <maxRatio> <label> [same-flows]
// A PR may not grow a size or memory figure past maxRatio × main's last successful run.
// same-flows: compare only when both runs ran the same flows. Memory depends on what the app showed before it was
// measured (the reader with or without Bible text), so a baseline from a different set of flows is not comparable.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { selectSizeBaseline } from './size-baseline';

type Summary = Record<string, unknown> & { flows?: Record<string, string> };
const [currentPath, baselinePath, field, maxRatio, label, mode, sizeResetPath] = process.argv.slice(2);
const current = JSON.parse(readFileSync(currentPath, 'utf8')) as Summary;
if (!baselinePath || !existsSync(baselinePath)) { console.log(`| ${label} | 略過 | main 還沒有基準 |`); process.exit(0); }
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Summary;
const measuredPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
if (!measuredPositive(current[field]) || !measuredPositive(baseline[field])) {
  console.log(`| ${label} | FAIL | current/main 必須是實測的正數，不能用缺值、0 或字串 |`);
  process.exit(1);
}
if (mode === 'same-flows') {
  // run-flows.sh measures home/reader before 43. Adding the late OTA interaction must not
  // turn off the existing 1.10 memory guard; all earlier flow/key distinctions still apply.
  const ran = (summary: Summary) => Object.entries(summary.flows ?? {})
    .filter(([name, result]) => result !== 'SKIP' && !(field === 'footprintMB' && name === '43-ota-channel'))
    .map(([name]) => name).sort().join(',');
  if (ran(current) !== ran(baseline)) {
    console.log(`| ${label} | 略過 | 跑的流程和 main 的基準不同，不能直接比；合併後 main 會用這組流程重新記錄基準 |`);
    process.exit(0);
  }
}
const mainBytes = Number(baseline[field]);
// Bind the explicit measured floor to raw committed lockfile bytes (portable across CRLF/LF checkouts).
const lockDigest = sizeResetPath ? createHash('sha256').update(execFileSync('git', ['cat-file', 'blob', 'HEAD:package-lock.json'])).digest('hex') : '';
const measuredReset = sizeResetPath ? JSON.parse(readFileSync(sizeResetPath, 'utf8')) : null;
const effectiveBaseline = selectSizeBaseline(field, mainBytes, measuredReset, lockDigest);
const ratio = Number(current[field]) / effectiveBaseline;
const ok = Number.isFinite(ratio) && ratio <= Number(maxRatio);
const unit = field === 'footprintMB' ? 'MB' : 'bytes';
console.log(`| ${label} | ${ok ? 'PASS' : 'FAIL'} | ${current[field]} vs main ${baseline[field]} (增加 ${Number(current[field]) - mainBytes}${unit}; 基準 ${effectiveBaseline}; ×${ratio.toFixed(3)}, 上限 ×${maxRatio}) |`);
process.exit(ok ? 0 : 1);
