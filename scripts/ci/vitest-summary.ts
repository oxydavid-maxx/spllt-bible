// scripts/ci/vitest-summary.ts
// usage: tsx scripts/ci/vitest-summary.ts <vitest-json> <out-json> [vitest-exit-code]
// Prints a PASS/FAIL table for the job summary and exits 1 when anything failed: a test, a test file that threw
// while loading (its tests never ran, so numFailedTests misses it), or a vitest run that exited non-zero with
// nothing else to show for it (unhandled errors are not in the JSON report at all).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

type Assertion = { fullName: string; status: string; failureMessages?: string[] };
type Report = {
  numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests?: number; success?: boolean;
  testResults: Array<{ name: string; status?: string; message?: string; assertionResults: Assertion[] }>;
};

const [input, output, exitArg] = process.argv.slice(2);
if (!input || !output) { console.error('usage: tsx scripts/ci/vitest-summary.ts <vitest-json> <out-json> [vitest-exit-code]'); process.exit(2); }
const haveReport = existsSync(input);
const report: Report = haveReport ? JSON.parse(readFileSync(input, 'utf8')) as Report : { numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, testResults: [] };
const exitCode = exitArg === undefined ? 0 : Number(exitArg);
const short = (name: string) => name.replace(/^.*?tests[\\/]/, 'tests/');
// One line of why, so nobody has to open the full log to see what broke.
const firstLine = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 160);
const failedTests = report.testResults.flatMap((file) => file.assertionResults
  .filter((test) => test.status === 'failed')
  .map((test) => {
    const why = firstLine(test.failureMessages?.[0] ?? '');
    return `${short(file.name)} > ${test.fullName}${why ? ` — ${why}` : ''}`;
  }));
// A file that threw while loading (a broken import, a top-level throw) is failed with its error in `message`
// and no failed test inside: none of its tests ran.
const failedFiles = report.testResults
  .filter((file) => file.status === 'failed' && !file.assertionResults.some((test) => test.status === 'failed'))
  .map((file) => `${short(file.name)}${file.message ? ` — ${firstLine(file.message)}` : ''}`);
const explained = failedTests.length > 0 || failedFiles.length > 0;
const problems = [
  ...(haveReport ? [] : [`沒有 ${input}：vitest 沒寫出報告，看 vitest.log`]),
  ...(!explained && report.success === false ? ['vitest 報告 success=false'] : []),
  ...(!Number.isInteger(exitCode) ? [`看不懂的 vitest 結束碼「${exitArg}」`]
    : !explained && exitCode !== 0 ? [`vitest 結束碼 ${exitCode}：有 unhandled error 或程序沒正常結束，看 vitest.log`] : []),
];
const pass = !explained && problems.length === 0;
const summary = { passed: report.numPassedTests, skipped: report.numPendingTests + (report.numTodoTests ?? 0), failed: report.numFailedTests, failedTests, failedFiles, problems };
writeFileSync(output, JSON.stringify(summary));
console.log(`| 項目 | 結果 |\n|---|---|\n| vitest | ${pass ? 'PASS' : 'FAIL'} |\n| 通過／略過／失敗 | ${summary.passed}／${summary.skipped}／${summary.failed} |`);
for (const name of failedTests.slice(0, 20)) console.log(`- FAIL ${name}`);
for (const name of failedFiles.slice(0, 20)) console.log(`- FAIL 載入失敗 ${name}`);
for (const problem of problems) console.log(`- FAIL ${problem}`);
console.log(`\n\`${JSON.stringify({ unit: pass ? 'PASS' : 'FAIL', passed: summary.passed, skipped: summary.skipped, failed: summary.failed, failedFiles: failedFiles.length })}\``);
process.exit(pass ? 0 : 1);
