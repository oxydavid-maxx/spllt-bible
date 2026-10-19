import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectSizeBaseline } from '../../scripts/ci/size-baseline';

const measurement = { beforeBytes: 1000, afterBytes: 1100, beforeRunId: '1', afterRunId: '2', beforeCommit: 'a'.repeat(40), afterCommit: 'b'.repeat(40) };
const allowance = { reason: 'expo-updates native dependency', dependency: { name: 'expo-updates', version: '56.0.28' }, measurements: { apkBytes: measurement } };
const lockWith = (version: string | null) => ({ packages: version ? { 'node_modules/expo-updates': { version } } : {} });
const mainWithout = { dependencies: { expo: '~56.0.0' } };
const mainWith = { dependencies: { expo: '~56.0.0', 'expo-updates': '~56.0.28' } };
const context = { currentLock: lockWith('56.0.28'), basePackageJson: mainWithout };

// The committed allowance, the real lockfile and the real package.json are what CI reads.
const realAllowance = JSON.parse(readFileSync('scripts/ci/eas-update-size-baseline.json', 'utf8'));
const realPackage = JSON.parse(readFileSync('package.json', 'utf8'));
const { 'expo-updates': _adopted, ...dependenciesBeforeAdoption } = realPackage.dependencies;
const realMainBefore = { ...realPackage, dependencies: dependenciesBeforeAdoption };

function compare(current: object, baseline: object, field: string, ratio: string, extra: Array<string | object | null> = []) {
  const dir = mkdtempSync(join(tmpdir(), 'qm-ota-size-'));
  try {
    const write = (name: string, value: object) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(value)); return path; };
    const args = extra.map((value, index) => value === null ? join(dir, `missing-${index}.json`) : typeof value === 'string' ? value : write(`extra-${index}.json`, value));
    return spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/ci/compare-baseline.ts', write('current.json', current), write('baseline.json', baseline), field, ratio, 'APK', ...args], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('expo-updates native size allowance', () => {
  it('does not waive the memory ratio just because the new OTA flow runs after idle measurement', () => {
    const result = compare({ footprintMB: 111, flows: { '00-smoke': 'PASS', '10-reader-open': 'PASS', '43-ota-channel': 'PASS' } }, { footprintMB: 100, flows: { '00-smoke': 'PASS', '10-reader-open': 'PASS' } }, 'footprintMB', '1.10', ['same-flows']);
    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stdout).not.toContain('略過');
  });
  it.each([null, 0, '1000'])('rejects an invalid current measurement (%s) in the actual CI producer', (invalid) => {
    const result = compare({ apkBytes: invalid }, { apkBytes: 1000 }, 'apkBytes', '1.002');
    expect(result.status, result.stderr || result.stdout).toBe(1);
  });

  it('adds the measured native increment to whatever main measures while main predates expo-updates', () => {
    expect(selectSizeBaseline('apkBytes', 1000, allowance, context)).toMatchObject({ bytes: 1100, allowanceBytes: 100 });
    // Another 0.5.35 PR merged first: main is a few KB bigger, the allowance still applies on top of it.
    expect(selectSizeBaseline('apkBytes', 1004, allowance, context)).toMatchObject({ bytes: 1104, allowanceBytes: 100 });
  });
  it('stops adding the increment once main itself contains expo-updates', () => {
    expect(selectSizeBaseline('apkBytes', 1100, allowance, { ...context, basePackageJson: mainWith })).toMatchObject({ bytes: 1100, allowanceBytes: 0 });
    expect(selectSizeBaseline('apkBytes', 1100, allowance, { ...context, basePackageJson: { dependencies: {}, devDependencies: { 'expo-updates': '1' } } })).toMatchObject({ bytes: 1100, allowanceBytes: 0 });
  });
  it('fails closed when main\'s dependencies cannot be read or the candidate does not carry the measured version', () => {
    for (const basePackageJson of [null, undefined, {}, 'not json', { dependencies: null }]) {
      expect(selectSizeBaseline('apkBytes', 1000, allowance, { ...context, basePackageJson }).bytes).toBe(1000);
    }
    expect(selectSizeBaseline('apkBytes', 1000, allowance, { ...context, currentLock: lockWith('56.0.29') }).bytes).toBe(1000);
    expect(selectSizeBaseline('apkBytes', 1000, allowance, { ...context, currentLock: lockWith(null) }).bytes).toBe(1000);
    expect(selectSizeBaseline('apkBytes', 1000, allowance, { ...context, currentLock: null }).bytes).toBe(1000);
  });
  it('never changes memory, and rejects unmeasured, malformed, zero or shrinking measurements', () => {
    expect(selectSizeBaseline('footprintMB', 1000, allowance, context).bytes).toBe(1000);
    expect(selectSizeBaseline('appBytes', 1000, allowance, context).bytes).toBe(1000);
    for (const afterBytes of [0, -1, NaN, null, '1100', 1000, 999, 1100.5]) {
      expect(selectSizeBaseline('apkBytes', 1000, { ...allowance, measurements: { apkBytes: { ...measurement, afterBytes } } }, context).bytes).toBe(1000);
    }
    for (const broken of [{ afterCommit: '' }, { afterRunId: '' }, { beforeCommit: 'x' }, { beforeRunId: null }, { beforeBytes: '1000' }]) {
      expect(selectSizeBaseline('apkBytes', 1000, { ...allowance, measurements: { apkBytes: { ...measurement, ...broken } } }, context).bytes).toBe(1000);
    }
    expect(selectSizeBaseline('apkBytes', 1000, { ...allowance, dependency: undefined }, context).bytes).toBe(1000);
    expect(selectSizeBaseline('apkBytes', 1000, { ...allowance, reason: '' }, context).bytes).toBe(1000);
    expect(selectSizeBaseline('apkBytes', 1000, null, context).bytes).toBe(1000);
  });

  it('keeps the committed measurement bound to the version this candidate actually installs', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    expect(realAllowance.dependency).toEqual({ name: 'expo-updates', version: lock.packages['node_modules/expo-updates'].version });
    expect(realPackage.dependencies['expo-updates']).toBeDefined();
    expect(selectSizeBaseline('apkBytes', 62709053, realAllowance, { currentLock: lock, basePackageJson: realMainBefore })).toMatchObject({ bytes: 66334086, allowanceBytes: 3625033 });
    expect(selectSizeBaseline('appBytes', 142200579, realAllowance, { currentLock: lock, basePackageJson: realMainBefore })).toMatchObject({ bytes: 146029090, allowanceBytes: 3828511 });
  });
  // Measured 0.5.35 sibling APKs at main 7e8ece8 (#73, #71, #70, #68, #66) and their sum of growth.
  it.each([62725285, 62715593, 62710761, 62710197, 62710789, 62709053 + 16232 + 6540 + 1708 + 1144 + 1736])('passes the real Android gate in any merge order (main %i bytes before this PR)', (mainBytes) => {
    const candidate = mainBytes + (66334338 - 62709053);
    const result = compare({ apkBytes: candidate }, { apkBytes: mainBytes }, 'apkBytes', '1.002', ['-', 'scripts/ci/eas-update-size-baseline.json', realMainBefore]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('| APK | PASS |');
  });
  it.each([['android', 'apkBytes'], ['ios', 'appBytes']])('the %s size gate reads package.json from the commit that measured main', (workflow, field) => {
    const yml = readFileSync(`.github/workflows/${workflow}.yml`, 'utf8');
    expect(yml).toContain('--json databaseId,headSha');
    expect(yml).toContain('git show "$SHA:package.json" > ci-out/base/package.json');
    expect(yml).toMatch(new RegExp(`${field} [0-9.]+ "[^"]+" - scripts/ci/eas-update-size-baseline\\.json ci-out/base/package\\.json`));
  });
  it('compares against main alone after the merge, and fails closed when main\'s package.json is unknown', () => {
    const merged = compare({ apkBytes: 66350570 }, { apkBytes: 62725285 }, 'apkBytes', '1.002', ['-', 'scripts/ci/eas-update-size-baseline.json', realPackage]);
    expect(merged.status, merged.stdout).toBe(1);
    const afterAdoption = compare({ apkBytes: 66360000 }, { apkBytes: 66350570 }, 'apkBytes', '1.002', ['-', 'scripts/ci/eas-update-size-baseline.json', realPackage]);
    expect(afterAdoption.status, afterAdoption.stdout).toBe(0);
    const unknown = compare({ apkBytes: 66350570 }, { apkBytes: 62725285 }, 'apkBytes', '1.002', ['-', 'scripts/ci/eas-update-size-baseline.json', null]);
    expect(unknown.status, unknown.stdout).toBe(1);
    expect(unknown.stdout).toContain('無法確認');
  });
});
