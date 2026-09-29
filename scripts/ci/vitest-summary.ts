// scripts/ci/vitest-summary.ts
// usage: tsx scripts/ci/vitest-summary.ts <vitest-json> <out-json>
// Prints a PASS/FAIL table for the job summary and exits 1 when any test failed.
import { readFileSync, writeFileSync } from 'node:fs';

type Assertion = { fullName: string; status: string };
type Report = { numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests?: number; testResults: Array<{ name: string; assertionResults: Assertion[] }> };

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: tsx scripts/ci/vitest-summary.ts <vitest-json> <out-json>'); process.exit(2); }
const report = JSON.parse(readFileSync(input, 'utf8')) as Report;
const failedTests = report.testResults.flatMap((file) => file.assertionResults
  .filter((test) => test.status === 'failed')
  .map((test) => `${file.name.replace(/^.*?tests[\\/]/, 'tests/')} > ${test.fullName}`));
const summary = { passed: report.numPassedTests, skipped: report.numPendingTests + (report.numTodoTests ?? 0), failed: report.numFailedTests, failedTests };
writeFileSync(output, JSON.stringify(summary));
console.log(`| 項目 | 結果 |\n|---|---|\n| vitest | ${summary.failed === 0 ? 'PASS' : 'FAIL'} |\n| 通過／略過／失敗 | ${summary.passed}／${summary.skipped}／${summary.failed} |`);
for (const name of failedTests.slice(0, 20)) console.log(`- FAIL ${name}`);
console.log(`\n\`${JSON.stringify({ unit: summary.failed === 0 ? 'PASS' : 'FAIL', passed: summary.passed, skipped: summary.skipped, failed: summary.failed })}\``);
process.exit(summary.failed === 0 ? 0 : 1);
