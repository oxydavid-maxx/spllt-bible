import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Announcement } from './build';

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
  }).trim();
}

function blob(repo: string, ref: string, path: string): Buffer {
  return execFileSync('git', ['-C', repo, 'show', `${ref}:${path}`], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
  });
}

function outputPaths(week: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || new Date(`${week}T00:00:00Z`).toISOString().slice(0, 10) !== week) {
    throw new Error('INVALID_ANNOUNCEMENT_WEEK');
  }
  return ['announcements/latest.json', `announcements/${week.replace(/-/g, '')}.json`];
}

/** Ignore only the run timestamp, just as the original weekly job did. */
function contentOf(announcement: Announcement): string {
  const { generatedAt, ...rest } = announcement;
  void generatedAt;
  return JSON.stringify(rest);
}

function cleanCheckout(repo: string): void {
  if (git(repo, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('PUBLISH_CHECKOUT_DIRTY: preserve the existing work and index before publishing');
  }
}

/** Only the publisher's paired files may be replayed or pushed from a previous failed run. */
function validatePendingCommit(repo: string, commit: string): void {
  if (git(repo, ['rev-list', '--parents', '-n', '1', commit]).split(' ').length !== 2) {
    throw new Error('UNRELATED_PENDING_COMMIT: merge/root commits cannot be published automatically');
  }
  const pending = JSON.parse(blob(repo, commit, 'announcements/latest.json').toString('utf8')) as Announcement;
  const allowed = outputPaths(pending.week);
  const changes = git(repo, ['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', commit]).split('\n');
  if (changes.length < 1 || changes.length > 2 || changes.some((line) => {
    const [status, path] = line.split('\t');
    return !['A', 'M'].includes(status) || !allowed.includes(path);
  })) throw new Error('UNRELATED_PENDING_COMMIT: only an announcement and its week archive may be recovered');
  for (const path of allowed) {
    if (!git(repo, ['ls-tree', commit, '--', path]).startsWith('100644 blob ')) {
      throw new Error('UNSAFE_ANNOUNCEMENT_PATH');
    }
  }
  if (!blob(repo, commit, allowed[0]).equals(blob(repo, commit, allowed[1]))) {
    throw new Error('UNRELATED_PENDING_COMMIT: announcement and archive differ');
  }
}

function fetchMain(repo: string): void {
  git(repo, ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
}

/**
 * Publish from the existing dedicated main checkout. Failed pushes leave a clean, recoverable
 * announcement commit. A later run checks origin even when the generated content has not changed.
 */
export function publishAnnouncement(repo: string, announcement: Announcement, options: {
  /** Exact local fallback files used by the builder before this function reconciles origin/main. */
  fallbackFiles?: ReadonlyMap<string, string | null>;
} = {}): 'published' | 'unchanged' {
  const paths = outputPaths(announcement.week);
  const canonical = (path: string) => {
    const value = realpathSync(resolve(path));
    return process.platform === 'win32' ? value.toLowerCase() : value;
  };
  if (canonical(git(repo, ['rev-parse', '--show-toplevel'])) !== canonical(repo)
    || git(repo, ['branch', '--show-current']) !== 'main') {
    throw new Error('PUBLISH_CHECKOUT_REQUIRED: use the dedicated repository root on main');
  }
  cleanCheckout(repo);
  fetchMain(repo);
  const originalRemote = git(repo, ['rev-parse', 'refs/remotes/origin/main']);
  const base = git(repo, ['merge-base', 'HEAD', originalRemote]);
  const pending = git(repo, ['rev-list', '--reverse', `${originalRemote}..HEAD`]).split('\n').filter(Boolean);
  for (const commit of pending) validatePendingCommit(repo, commit);

  if (pending.length === 0) {
    git(repo, ['merge', '--ff-only', originalRemote]);
  } else if (base !== originalRemote) {
    try {
      git(repo, ['rebase', '--onto', originalRemote, base, 'main']);
    } catch (reason) {
      // The preflight was clean and every replayed commit belongs to this publisher. Abort restores
      // that exact pre-rebase checkout, preserving the pending commit for inspection or a later retry.
      git(repo, ['rebase', '--abort']);
      throw new Error('PUBLISH_RECONCILE_CONFLICT: pending announcement preserved; remote unchanged', { cause: reason });
    }
  }
  cleanCheckout(repo);

  for (const [path, expected] of options.fallbackFiles ?? []) {
    if (!/^announcements\/(?:latest|\d{8})\.json$/.test(path)) throw new Error('UNSAFE_ANNOUNCEMENT_FALLBACK_PATH');
    let current: string | null = null;
    try { current = readFileSync(join(repo, path), 'utf8'); } catch { /* Missing is also part of the snapshot. */ }
    if (current !== expected) {
      // Keep the reconciled checkout, but do not publish a draft based on superseded fallback data.
      // The next run rebuilds from these current files; no forced overwrite or hidden retry is needed.
      throw new Error('ANNOUNCEMENT_FALLBACK_CHANGED: checkout updated; rebuild before publishing');
    }
  }

  const directory = join(repo, 'announcements');
  if (existsSync(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) {
    throw new Error('UNSAFE_ANNOUNCEMENT_PATH');
  }
  for (const path of paths) {
    const target = join(repo, path);
    if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()
      || !git(repo, ['ls-files', '--', path]))) throw new Error('UNSAFE_ANNOUNCEMENT_PATH');
  }
  const changed = paths.some((path) => {
    try { return contentOf(JSON.parse(readFileSync(join(repo, path), 'utf8')) as Announcement) !== contentOf(announcement); }
    catch { return true; }
  });
  if (changed) {
    mkdirSync(directory, { recursive: true });
    const json = `${JSON.stringify(announcement, null, 2)}\n`;
    for (const path of paths) writeFileSync(join(repo, path), json, 'utf8');
    git(repo, ['add', '--', ...paths]);
    const staged = git(repo, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    if (staged.some((path) => !paths.includes(path))) throw new Error('PUBLISH_INDEX_CHANGED: unrelated staged work preserved');
    git(repo, ['commit', '-m', `Announcement for ${announcement.week}`, '--only', '--', ...paths]);
  }

  const candidate = git(repo, ['rev-parse', 'HEAD']);
  const expected = paths.map((path) => blob(repo, candidate, path));
  const pushed = candidate !== originalRemote;
  if (pushed) git(repo, ['push', 'origin', 'HEAD:refs/heads/main']);
  // A successful command alone is not a publication receipt: read back the remote branch and blobs.
  fetchMain(repo);
  git(repo, ['merge-base', '--is-ancestor', candidate, 'refs/remotes/origin/main']);
  if (paths.some((path, index) => !blob(repo, 'refs/remotes/origin/main', path).equals(expected[index]))) {
    throw new Error('PUBLISH_READBACK_MISMATCH: remote announcement differs from the candidate');
  }
  return pushed ? 'published' : 'unchanged';
}
