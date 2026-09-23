import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertPatchesApplied,
  computeDepsDigest,
  extractPatchTargets,
  readStampDigest,
  syncDeps,
  verifyPatchesApplied,
  writeStampDigest,
} from '../../src/config/depsSync';

const FAKE_PATCH = `diff --git a/node_modules/fake-pkg/index.js b/node_modules/fake-pkg/index.js
index 1111111..2222222 100644
--- a/node_modules/fake-pkg/index.js
+++ b/node_modules/fake-pkg/index.js
@@ -1,3 +1,6 @@
 function existing() {
   return 1;
 }
+
+function trimVerseWrapEdges(nodes) {
+  return nodes;
+}
`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qm-deps-sync-'));
  mkdirSync(join(root, 'patches'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'fake-pkg'), { recursive: true });
  writeFileSync(join(root, 'patches', 'fake-pkg+1.0.0.patch'), FAKE_PATCH, 'utf8');
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3 }), 'utf8');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('extractPatchTargets', () => {
  it('collects only the real added lines, keyed by the b/ target path', () => {
    const targets = extractPatchTargets(FAKE_PATCH);
    expect(targets).toHaveLength(1);
    expect(targets[0].targetRelPath).toBe('node_modules/fake-pkg/index.js');
    expect(targets[0].addedLines).toEqual(['function trimVerseWrapEdges(nodes) {', '  return nodes;', '}']);
  });
});

describe('verifyPatchesApplied / assertPatchesApplied — real stale state, not a missing-file short-circuit', () => {
  it('reports NOT applied when the target file exists but was never patched (stale node_modules)', () => {
    // The file is present — this is the exact "npm ci ran once, long ago" shape that a
    // naive `if (!exists) fail` gate would miss. The content simply predates the patch.
    writeFileSync(
      join(root, 'node_modules', 'fake-pkg', 'index.js'),
      'function existing() {\n  return 1;\n}\n',
      'utf8',
    );
    const results = verifyPatchesApplied(root, join(root, 'patches'));
    expect(results).toHaveLength(1);
    expect(results[0].applied).toBe(false);
    expect(results[0].missingLines).toContain('function trimVerseWrapEdges(nodes) {');
    expect(() => assertPatchesApplied(root, join(root, 'patches'))).toThrow(/not applied/);
  });

  it('reports applied when the target file already contains every added line', () => {
    writeFileSync(
      join(root, 'node_modules', 'fake-pkg', 'index.js'),
      'function existing() {\n  return 1;\n}\n\nfunction trimVerseWrapEdges(nodes) {\n  return nodes;\n}\n',
      'utf8',
    );
    const results = verifyPatchesApplied(root, join(root, 'patches'));
    expect(results[0].applied).toBe(true);
    expect(results[0].missingLines).toEqual([]);
    expect(() => assertPatchesApplied(root, join(root, 'patches'))).not.toThrow();
  });

  it('reports NOT applied when the target file is entirely missing (package never installed)', () => {
    rmSync(join(root, 'node_modules', 'fake-pkg'), { recursive: true, force: true });
    const results = verifyPatchesApplied(root, join(root, 'patches'));
    expect(results[0].applied).toBe(false);
    expect(results[0].missingLines.length).toBeGreaterThan(0);
  });
});

describe('computeDepsDigest', () => {
  it('changes when a patch file changes, and is stable for identical inputs', () => {
    const patchesDir = join(root, 'patches');
    const digestA = computeDepsDigest(root, patchesDir);
    const digestB = computeDepsDigest(root, patchesDir);
    expect(digestA).toBe(digestB);
    writeFileSync(join(root, 'patches', 'fake-pkg+1.0.0.patch'), `${FAKE_PATCH}\n`, 'utf8');
    const digestC = computeDepsDigest(root, patchesDir);
    expect(digestC).not.toBe(digestA);
  });

  it('changes when package-lock.json changes', () => {
    const patchesDir = join(root, 'patches');
    const digestA = computeDepsDigest(root, patchesDir);
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 4 }), 'utf8');
    const digestB = computeDepsDigest(root, patchesDir);
    expect(digestB).not.toBe(digestA);
  });
});

describe('syncDeps — the guard the official build entry calls', () => {
  it('runs npm ci when no stamp exists yet, then fails closed anyway if the reinstall did not actually patch anything', () => {
    // Simulate the real 0.5.9 defect: node_modules exists (stale), no stamp yet, and the
    // injected "npm ci" is a no-op stand-in for a reinstall that (for whatever reason)
    // left the file unpatched. The guard must still refuse to proceed.
    writeFileSync(
      join(root, 'node_modules', 'fake-pkg', 'index.js'),
      'function existing() {\n  return 1;\n}\n',
      'utf8',
    );
    let npmCiCalls = 0;
    expect(() =>
      syncDeps(root, {
        npmCi: () => {
          npmCiCalls += 1;
          // deliberately does not touch node_modules — models a reinstall whose
          // postinstall/patch-package step silently failed to take effect
        },
      }),
    ).toThrow(/not applied/);
    expect(npmCiCalls).toBe(1);
    // No stamp was written for a failed sync — the next run must not trust this state.
    expect(readStampDigest(root)).toBeNull();
  });

  it('does not call npm ci when the stamp already matches, but still verifies patches are applied', () => {
    const patchesDir = join(root, 'patches');
    const digest = computeDepsDigest(root, patchesDir);
    writeFileSync(
      join(root, 'node_modules', 'fake-pkg', 'index.js'),
      'function existing() {\n  return 1;\n}\n\nfunction trimVerseWrapEdges(nodes) {\n  return nodes;\n}\n',
      'utf8',
    );
    writeStampDigest(root, digest);
    let npmCiCalls = 0;
    const receipt = syncDeps(root, { npmCi: () => { npmCiCalls += 1; } });
    expect(npmCiCalls).toBe(0);
    expect(receipt.ranInstall).toBe(false);
    expect(receipt.verifications.every((v) => v.applied)).toBe(true);
  });

  it('still fails closed on a stale tree even when a stamp is present but no longer matches the current lockfile+patches', () => {
    const patchesDir = join(root, 'patches');
    writeStampDigest(root, 'stale-digest-from-a-previous-lockfile');
    writeFileSync(
      join(root, 'node_modules', 'fake-pkg', 'index.js'),
      'function existing() {\n  return 1;\n}\n',
      'utf8',
    );
    let npmCiCalls = 0;
    expect(() =>
      syncDeps(root, { npmCi: () => { npmCiCalls += 1; } }),
    ).toThrow(/not applied/);
    expect(npmCiCalls).toBe(1);
    void patchesDir;
  });

  it('writes the stamp only after verification passes, and the stamp then equals the current digest', () => {
    const patchesDir = join(root, 'patches');
    writeFileSync(
      join(root, 'node_modules', 'fake-pkg', 'index.js'),
      'function existing() {\n  return 1;\n}\n',
      'utf8',
    );
    const receipt = syncDeps(root, {
      npmCi: () => {
        // a real npm ci followed by a successful postinstall would leave this content behind
        writeFileSync(
          join(root, 'node_modules', 'fake-pkg', 'index.js'),
          'function existing() {\n  return 1;\n}\n\nfunction trimVerseWrapEdges(nodes) {\n  return nodes;\n}\n',
          'utf8',
        );
      },
    });
    expect(receipt.ranInstall).toBe(true);
    expect(readStampDigest(root)).toBe(computeDepsDigest(root, patchesDir));
    expect(readFileSync(join(root, 'node_modules', '.qingmu-deps-digest'), 'utf8').trim()).toBe(receipt.digest);
  });
});
