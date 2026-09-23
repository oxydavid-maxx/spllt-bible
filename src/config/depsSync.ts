import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PatchTarget {
  /** Path relative to the project root, e.g. node_modules/@youversion/platform-core/dist/x.js */
  targetRelPath: string;
  /** Every added ("+") line from the diff hunks touching this target, in order, with the leading '+' stripped. */
  addedLines: string[];
}

export interface PatchVerification {
  patchFileName: string;
  targetRelPath: string;
  applied: boolean;
  missingLines: string[];
}

export interface DepsSyncReceipt {
  digest: string;
  stampDigestBefore: string | null;
  ranInstall: boolean;
  verifications: PatchVerification[];
}

const STAMP_RELATIVE_PATH = join('node_modules', '.qingmu-deps-digest');

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Parse a unified diff (as produced by patch-package) into one entry per target file,
 * carrying every added line from every hunk. A single patch file may touch more than
 * one file, so this returns an array rather than a single target.
 */
export function extractPatchTargets(patchContent: string): PatchTarget[] {
  const lines = patchContent.split(/\r?\n/);
  const targets: PatchTarget[] = [];
  let current: PatchTarget | null = null;
  for (const line of lines) {
    const targetHeaderMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (targetHeaderMatch) {
      current = { targetRelPath: targetHeaderMatch[1], addedLines: [] };
      targets.push(current);
      continue;
    }
    if (!current) continue;
    // A real added content line starts with a single '+', never '+++' (already matched above)
    // and never '+' immediately followed by another diff-header token.
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const content = line.slice(1);
      if (content.trim().length > 0) {
        current.addedLines.push(content);
      }
    }
  }
  return targets;
}

/**
 * Fail-closed check: for every patches/*.patch file, confirm every added line it
 * introduces is actually present, verbatim, in the corresponding node_modules file.
 * This deliberately reads the real target file rather than trusting any earlier
 * existence check, so a file that exists but was never patched is caught here
 * rather than short-circuited by a prior "does the path exist" gate.
 */
export function verifyPatchesApplied(projectRoot: string, patchesDir: string): PatchVerification[] {
  const patchFiles = readdirSync(patchesDir).filter((name) => name.endsWith('.patch')).sort();
  const results: PatchVerification[] = [];
  for (const patchFileName of patchFiles) {
    const patchContent = readFileSync(join(patchesDir, patchFileName), 'utf8');
    const targets = extractPatchTargets(patchContent);
    for (const target of targets) {
      const absoluteTargetPath = join(projectRoot, target.targetRelPath);
      let actualContent = '';
      let fileExists = false;
      if (existsSync(absoluteTargetPath)) {
        fileExists = true;
        actualContent = readFileSync(absoluteTargetPath, 'utf8');
      }
      const missingLines = fileExists
        ? target.addedLines.filter((addedLine) => !actualContent.includes(addedLine))
        : target.addedLines;
      results.push({
        patchFileName,
        targetRelPath: target.targetRelPath,
        applied: fileExists && missingLines.length === 0,
        missingLines,
      });
    }
  }
  return results;
}

export function assertPatchesApplied(projectRoot: string, patchesDir: string): PatchVerification[] {
  const verifications = verifyPatchesApplied(projectRoot, patchesDir);
  const failed = verifications.filter((v) => !v.applied);
  if (failed.length > 0) {
    const detail = failed
      .map((v) => `  ${v.patchFileName} -> ${v.targetRelPath} (${v.missingLines.length} line(s) missing)`)
      .join('\n');
    throw new Error(
      `Dependency patches are not applied in node_modules. node_modules does not match ` +
        `package-lock.json + patches/*.patch and must not be built from:\n${detail}`,
    );
  }
  return verifications;
}

/** Digest over package-lock.json plus every patches/*.patch file, order-independent for patches. */
export function computeDepsDigest(projectRoot: string, patchesDir: string): string {
  const lockfileContent = readFileSync(join(projectRoot, 'package-lock.json'), 'utf8');
  const patchFiles = readdirSync(patchesDir).filter((name) => name.endsWith('.patch')).sort();
  const hash = createHash('sha256');
  hash.update(lockfileContent, 'utf8');
  for (const patchFileName of patchFiles) {
    hash.update(patchFileName, 'utf8');
    hash.update(readFileSync(join(patchesDir, patchFileName), 'utf8'), 'utf8');
  }
  return hash.digest('hex');
}

export function readStampDigest(projectRoot: string): string | null {
  const stampPath = join(projectRoot, STAMP_RELATIVE_PATH);
  if (!existsSync(stampPath)) return null;
  return readFileSync(stampPath, 'utf8').trim() || null;
}

export function writeStampDigest(projectRoot: string, digest: string): void {
  writeFileSync(join(projectRoot, STAMP_RELATIVE_PATH), digest, 'utf8');
}

export interface SyncDepsOptions {
  npmCi: (cwd: string) => void;
  patchesDirName?: string;
}

/**
 * Bring node_modules to exactly package-lock.json + patches/*.patch before a build:
 * - if the digest over the lockfile+patches differs from the last-synced stamp (or no
 *   stamp exists), run `npm ci` (which reinstalls node_modules from the lockfile and
 *   runs the `postinstall` -> `patch-package --error-on-fail` script);
 * - regardless of whether a reinstall happened, verify every patch is actually applied
 *   in the resulting tree and fail closed if not — this is what catches a reinstall
 *   that silently didn't patch, or a node_modules that was hand-edited afterward.
 * The stamp is only written once verification has passed, so a failed sync never
 * leaves behind a stamp that would make the next run wrongly trust the tree.
 */
export function syncDeps(projectRoot: string, options: SyncDepsOptions): DepsSyncReceipt {
  const patchesDir = join(projectRoot, options.patchesDirName ?? 'patches');
  const digest = computeDepsDigest(projectRoot, patchesDir);
  const stampDigestBefore = readStampDigest(projectRoot);
  let ranInstall = false;
  if (stampDigestBefore !== digest) {
    options.npmCi(projectRoot);
    ranInstall = true;
  }
  const verifications = assertPatchesApplied(projectRoot, patchesDir);
  writeStampDigest(projectRoot, digest);
  return { digest, stampDigestBefore, ranInstall, verifications };
}
