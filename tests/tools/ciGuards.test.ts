import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// CI gates that said PASS (or stayed green) over something that failed or never ran: the 2026-10-31 review,
// A9–A14 and A16 (jobs/2026-10-31-qingmu-codebase-review/REVIEW-20261031.md).
const tsx = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const withDir = <T>(fn: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'qm-ci-guards-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

describe('unit: vitest summary (A9)', () => {
  const passing = { numPassedTests: 3, numFailedTests: 0, numPendingTests: 0, success: true, testResults: [
    { name: '/w/tests/a.test.ts', status: 'passed', message: '', assertionResults: [{ fullName: 'a', status: 'passed' }] },
  ] };
  const summarize = (report: object | null, code?: string) => withDir((dir) => {
    if (report) writeFileSync(join(dir, 'vitest.json'), JSON.stringify(report));
    const run = tsx(['scripts/ci/vitest-summary.ts', join(dir, 'vitest.json'), join(dir, 'summary.json'), ...(code === undefined ? [] : [code])]);
    return { status: run.status, text: run.stdout + run.stderr };
  });

  it('passes a clean run', () => {
    const run = summarize(passing, '0');
    expect(run.status, run.text).toBe(0);
    expect(run.text).toContain('"unit":"PASS"');
  });

  it('fails a file that threw while loading, though no test inside it failed', () => {
    const run = summarize({ ...passing, success: false, testResults: [...passing.testResults,
      { name: '/w/tests/broken.test.ts', status: 'failed', message: "Cannot find module '../src/gone'", assertionResults: [] }] }, '1');
    expect(run.status, run.text).toBe(1);
    expect(run.text).toContain('載入失敗 tests/broken.test.ts');
    expect(run.text).toContain("Cannot find module '../src/gone'");
  });

  it('fails a run whose only trace is a non-zero exit code (an unhandled error)', () => {
    const run = summarize(passing, '1');
    expect(run.status, run.text).toBe(1);
    expect(run.text).toContain('vitest 結束碼 1');
  });

  it('fails when vitest wrote no report, and still fails a failed test', () => {
    expect(summarize(null, '1').status).toBe(1);
    const failed = summarize({ ...passing, numFailedTests: 1, success: false, testResults: [
      { name: '/w/tests/a.test.ts', status: 'failed', message: '', assertionResults: [{ fullName: 'a', status: 'failed', failureMessages: ['expected 1 to be 2'] }] }] }, '1');
    expect(failed.status).toBe(1);
    expect(failed.text).toContain('tests/a.test.ts > a — expected 1 to be 2');
  });

  it('is handed vitest\'s exit code by unit.yml instead of swallowing it', () => {
    const yml = readFileSync('.github/workflows/unit.yml', 'utf8');
    expect(yml).not.toMatch(/npx vitest run[^\n]*\|\| true/);
    expect(yml).toMatch(/npx vitest run[^\n]*\|\| code=\$\?/);
    expect(yml).toContain('ci-out/vitest-summary.json "$code"');
    expect(yml).toContain('ci-out/vitest.log');
  });
});

describe('android workflow (A10, A16)', () => {
  const yml = readFileSync('.github/workflows/android.yml', 'utf8');

  it('runs the expo-updates check with pipefail, so a FAIL piped into tee stops the job', () => {
    const step = yml.slice(yml.indexOf('- name: native expo-updates config'), yml.indexOf('- name: native diff vs main'));
    expect(step).toMatch(/^\s+shell: bash\s*$/m);
    expect(step).toContain('| tee -a "$GITHUB_STEP_SUMMARY"');
  });

  it('counts added, removed and binary native files in the native diff', () => {
    const pattern = /grep -cE '([^']+)' ci-out\/native-diff\.txt/.exec(yml)?.[1];
    expect(pattern).toBeDefined();
    const diff = ['diff -r ../base/android/app/src/main/AndroidManifest.xml android/app/src/main/AndroidManifest.xml', '3c3', '< a', '---', '> b',
      'Only in android/app/src/main/java/org/qingmu/youth: NewModule.kt', 'Binary files ../base/x.png and x.png differ'];
    expect(diff.filter((line) => new RegExp(pattern!).test(line))).toHaveLength(5);
  });
});

describe('ios guards (A11)', () => {
  it('compares CFBundleVersion with android.versionCode, the number app.config.js gives iOS', () => {
    const source = readFileSync('scripts/ios/guards.ts', 'utf8');
    expect(source).toContain('buildNumber: String(appJson.expo.android.versionCode)');
    expect(source).not.toContain('buildNumber: appJson.expo.ios.buildNumber');
    expect(readFileSync('app.config.js', 'utf8')).toContain('buildNumber: String(config.android?.versionCode ?? 1)');
  });
});

describe('ios summary (A12–A14)', () => {
  const okGuards = { appBytes: 60_000_000, guards: { I2: [], I3: [], I4: [], I5: [] } };
  const home = { cpuAvg: 0.4, footprintMB: 180, idleRequests: 0 };
  const summarize = (files: Record<string, object>) => withDir((dir) => {
    for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
    const run = tsx(['scripts/ios/summary.ts'], { OUT: dir });
    return { status: run.status, text: run.stdout + run.stderr };
  });

  it('passes measured flows within budget', () => {
    const run = summarize({ 'guards.json': okGuards, 'flows.json': { '00-smoke': 'PASS', '10-reader-open': 'PASS' }, 'runtime-home.json': home, 'runtime-reader.json': home });
    expect(run.status, run.text).toBe(0);
  });

  it('fails a smoke flow that passed on its rerun but left no measurement', () => {
    const run = summarize({ 'guards.json': okGuards, 'flows.json': { '00-smoke': 'RERUN-PASS', '10-reader-open': 'RERUN-PASS' } });
    expect(run.status, run.text).toBe(1);
    expect(run.text).toContain('沒有產生 runtime-home.json');
    expect(run.text).toContain('沒有產生 runtime-reader.json');
  });

  it('does not write PASS when the build or the guards failed before any flow ran', () => {
    for (const files of [{}, { 'guards.json': okGuards } as Record<string, object>, { 'guards.json': okGuards, 'flows.json': {} }, { 'guards.json': { ...okGuards, appBytes: 0 }, 'flows.json': { '00-smoke': 'PASS' }, 'runtime-home.json': home }]) {
      const run = summarize(files);
      expect(run.status, JSON.stringify(files)).toBe(1);
      expect(run.text).toContain('"ios":"FAIL"');
    }
    const guard = summarize({ 'guards.json': { ...okGuards, guards: { ...okGuards.guards, I3: ['CFBundleVersion is 59, expected 60'] } }, 'flows.json': { '00-smoke': 'PASS' }, 'runtime-home.json': home });
    expect(guard.status).toBe(1);
    expect(guard.text).toContain('| 守門 I3 | FAIL | CFBundleVersion is 59, expected 60 |');
  });

  it('skips R2 when the reader flow was skipped, even if something was measured', () => {
    const run = summarize({ 'guards.json': okGuards, 'flows.json': { '00-smoke': 'PASS', '10-reader-open': 'SKIP' }, 'runtime-home.json': home, 'runtime-reader.json': home });
    expect(run.status, run.text).toBe(0);
    expect(run.text).toContain('| R2 讀經器閒置 CPU ≤ 5.0% | 略過 | 讀經器流程略過 |');
  });

  it('measures the reader only after a reader flow that ran, and keeps its output for the artifact', () => {
    const line = readFileSync('scripts/ios/run-flows.sh', 'utf8').split('\n').find((text) => text.trimStart().startsWith('10-reader-open)'));
    expect(line).toContain('[ "$LAST_RESULT" = SKIP ] || bash scripts/ios/measure-idle.sh "$UDID" reader > "$OUT/maestro/measure-reader.txt" 2>&1');
  });
});
