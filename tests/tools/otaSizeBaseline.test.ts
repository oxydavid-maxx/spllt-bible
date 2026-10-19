import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectSizeBaseline } from '../../scripts/ci/size-baseline';

const measurement = { beforeBytes: 1000, afterBytes: 1100, beforeRunId: '1', afterRunId: '2', beforeCommit: 'a'.repeat(40), afterCommit: 'b'.repeat(40) };
const reset = { reason: 'expo-updates native dependency', packageLockGitBlobSha256: 'c'.repeat(64), measurements: { apkBytes: measurement } };

describe('explicit measured OTA size baseline', () => {
  it('does not waive the memory ratio just because the new OTA flow runs after idle measurement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qm-ota-memory-'));
    const current = join(dir, 'current.json'); const baseline = join(dir, 'baseline.json');
    writeFileSync(current, JSON.stringify({ footprintMB: 111, flows: { '00-smoke': 'PASS', '10-reader-open': 'PASS', '43-ota-channel': 'PASS' } }));
    writeFileSync(baseline, JSON.stringify({ footprintMB: 100, flows: { '00-smoke': 'PASS', '10-reader-open': 'PASS' } }));
    try {
      const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/ci/compare-baseline.ts', current, baseline, 'footprintMB', '1.10', 'R3', 'same-flows'], { encoding: 'utf8' });
      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stdout).not.toContain('略過');
    } finally { unlinkSync(current); unlinkSync(baseline); rmdirSync(dir); }
  });
  it.each([null, 0, '1000'])('rejects an invalid current measurement (%s) in the actual CI producer', (invalid) => {
    const dir = mkdtempSync(join(tmpdir(), 'qm-ota-size-'));
    const current = join(dir, 'current.json'); const baseline = join(dir, 'baseline.json');
    writeFileSync(current, JSON.stringify({ apkBytes: invalid })); writeFileSync(baseline, JSON.stringify({ apkBytes: 1000 }));
    try {
      const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/ci/compare-baseline.ts', current, baseline, 'apkBytes', '1.002', 'APK'], { encoding: 'utf8' });
      expect(result.status, result.stderr || result.stdout).toBe(1);
    } finally { unlinkSync(current); unlinkSync(baseline); rmdirSync(dir); }
  });
  it('uses the measured new floor only for the exact old baseline and dependency blob', () => {
    expect(selectSizeBaseline('apkBytes', 1000, reset, 'c'.repeat(64))).toBe(1100);
    expect(selectSizeBaseline('apkBytes', 1000, reset, 'd'.repeat(64))).toBe(1000);
    expect(selectSizeBaseline('apkBytes', 1001, reset, 'c'.repeat(64))).toBe(1001);
  });
  it('automatically returns to the main baseline after adoption, without changing memory or ratio limits', () => {
    expect(selectSizeBaseline('apkBytes', 1101, reset, 'c'.repeat(64))).toBe(1101);
    expect(selectSizeBaseline('footprintMB', 1000, reset, 'c'.repeat(64))).toBe(1000);
    expect(selectSizeBaseline('appBytes', 1000, reset, 'c'.repeat(64))).toBe(1000);
  });
  it('rejects unmeasured, malformed, zero and unbound baseline changes', () => {
    for (const invalid of [0, -1, NaN, null, '1100']) {
      expect(selectSizeBaseline('apkBytes', 1000, { ...reset, measurements: { apkBytes: { ...measurement, afterBytes: invalid } } }, 'c'.repeat(64))).toBe(1000);
    }
    expect(selectSizeBaseline('apkBytes', 1000, { ...reset, measurements: { apkBytes: { ...measurement, afterCommit: '' } } }, 'c'.repeat(64))).toBe(1000);
    expect(selectSizeBaseline('apkBytes', 1000, { ...reset, measurements: { apkBytes: { ...measurement, afterRunId: '' } } }, 'c'.repeat(64))).toBe(1000);
  });
});
