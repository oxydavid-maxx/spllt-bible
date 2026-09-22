import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Announcement } from '../../tools/announce/build';

const build = vi.hoisted(() => vi.fn());
vi.mock('../../tools/announce/build', () => ({ buildAnnouncement: build }));
vi.mock('../../tools/announce/review', () => ({ reviewAnnouncement: async () => ({ sensible: true }) }));

const roots: string[] = [];
const announcement: Announcement = {
  week: '2026-09-20', generatedAt: '2026-09-22T00:00:00.000Z',
  sermon: { title: 'Test sermon', speaker: null, passage: null, audio: null, slides: null, transcript: null, youtube: null },
  next: null, standing: null, past: [],
};
const paths = ['announcements/20260920.json', 'announcements/latest.json'];
const release = '{"versionCode":27,"url":"https://example.invalid/old.apk"}\n';
const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }).trim();
const blob = (repo: string, ref: string, path: string) => execFileSync('git', ['-C', repo, 'show', `${ref}:${path}`], { encoding: 'utf8' });
function put(repo: string, path: string, text: string) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); }
function configure(repo: string) {
  git(repo, 'config', 'user.name', 'Publisher acceptance');
  git(repo, 'config', 'user.email', 'publisher-test@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qingmu-publisher-')); roots.push(root);
  const remote = join(root, 'remote.git'), publisher = join(root, 'publisher'), editor = join(root, 'editor');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'pipe' });
  execFileSync('git', ['clone', remote, publisher], { stdio: 'pipe' }); configure(publisher);
  put(publisher, 'app-version.json', release);
  put(publisher, 'README.md', 'existing documentation\n');
  put(publisher, 'announcements/latest.json', JSON.stringify({ ...announcement, week: '2026-09-13' }) + '\n');
  put(publisher, 'announcements/20260913.json', 'previous week archive\n');
  git(publisher, 'add', '.'); git(publisher, 'commit', '-m', 'Initial published state'); git(publisher, 'push', 'origin', 'main');
  execFileSync('git', ['clone', remote, editor], { stdio: 'pipe' }); configure(editor);
  return { root, remote, publisher, editor };
}
function rejectPush(remote: string) { const hook = join(remote, 'hooks/pre-receive'); writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 }); return hook; }
async function run(repo: string, value: Announcement = announcement, dryRun = false) {
  const previousEnv = process.env.QINGMU_ANNOUNCE_REPO, previousArgv = process.argv, previousExit = process.exitCode;
  const output: string[] = [];
  const writer = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write);
  try {
    vi.resetModules(); build.mockResolvedValue({ announcement: value });
    process.env.QINGMU_ANNOUNCE_REPO = repo;
    process.argv = [process.execPath, 'tools/announce/index.ts', '--skip-review', ...(dryRun ? ['--dry-run'] : [])];
    process.exitCode = undefined;
    await import('../../tools/announce/index');
    await vi.waitFor(() => expect(process.exitCode).not.toBeUndefined());
    return { code: process.exitCode, output: output.join('') };
  } finally {
    writer.mockRestore(); process.argv = previousArgv; process.exitCode = previousExit;
    if (previousEnv === undefined) delete process.env.QINGMU_ANNOUNCE_REPO; else process.env.QINGMU_ANNOUNCE_REPO = previousEnv;
  }
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('qingmu-publisher-')) throw new Error('Unsafe fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

describe('announcement publisher with a real temporary bare Git remote', () => {
  it('publishes only the two exact announcement paths and verifies a true no-change rerun', async () => {
    const f = fixture(), initial = git(f.remote, 'rev-parse', 'main');
    expect((await run(f.publisher)).code).toBe(0);
    expect(git(f.remote, 'diff', '--name-only', initial, 'main').split('\n').sort()).toEqual(paths);
    expect(blob(f.remote, 'main', 'app-version.json')).toBe(release);
    expect(blob(f.remote, 'main', paths[0])).toBe(blob(f.remote, 'main', paths[1]));
    const published = git(f.remote, 'rev-parse', 'main');
    expect((await run(f.publisher, { ...announcement, generatedAt: '2026-09-23T00:00:00Z' })).code).toBe(0);
    expect(git(f.remote, 'rev-parse', 'main')).toBe(published);
    expect(git(f.publisher, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it('retries an already committed announcement after a failed push even when content is unchanged', async () => {
    const f = fixture(), initial = git(f.remote, 'rev-parse', 'main'), hook = rejectPush(f.remote);
    expect((await run(f.publisher)).code).toBe(1);
    expect(git(f.remote, 'rev-parse', 'main')).toBe(initial);
    const pending = git(f.publisher, 'rev-parse', 'HEAD');
    expect(pending).not.toBe(initial);
    expect(git(f.publisher, 'status', '--porcelain')).toBe('');
    unlinkSync(hook);
    expect((await run(f.publisher)).code).toBe(0);
    expect(git(f.remote, 'rev-parse', 'main')).toBe(pending);
  }, 30_000);

  it.each([false, true])('reconciles remote main changes and preserves release bytes (pending commit=%s)', async (pending) => {
    const f = fixture();
    if (pending) { const hook = rejectPush(f.remote); expect((await run(f.publisher)).code).toBe(1); unlinkSync(hook); }
    const updatedRelease = '{"versionCode":28,"url":"https://example.invalid/new.apk"}\n';
    put(f.editor, 'app-version.json', updatedRelease); git(f.editor, 'add', 'app-version.json'); git(f.editor, 'commit', '-m', 'Independent release'); git(f.editor, 'push', 'origin', 'main');
    const remoteHead = git(f.remote, 'rev-parse', 'main');
    expect((await run(f.publisher)).code).toBe(0);
    expect(blob(f.remote, 'main', 'app-version.json')).toBe(updatedRelease);
    expect(JSON.parse(blob(f.remote, 'main', paths[1])).week).toBe(announcement.week);
    expect(git(f.remote, 'diff', '--name-only', remoteHead, 'main').split('\n').sort()).toEqual(paths);
    expect(git(f.publisher, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it.each(['unstaged', 'staged', 'untracked'])('refuses an unrelated %s change without touching worktree or index', async (kind) => {
    const f = fixture();
    const path = kind === 'untracked' ? 'announcements/draft.json' : 'README.md';
    put(f.publisher, path, 'unrelated work\n');
    if (kind === 'staged') git(f.publisher, 'add', path);
    const head = git(f.publisher, 'rev-parse', 'HEAD'), status = git(f.publisher, 'status', '--porcelain'), index = git(f.publisher, 'write-tree');
    const result = await run(f.publisher);
    expect(result.code).toBe(1);
    expect(git(f.publisher, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(f.publisher, 'status', '--porcelain')).toBe(status);
    expect(git(f.publisher, 'write-tree')).toBe(index);
    expect(readFileSync(join(f.publisher, path), 'utf8')).toBe('unrelated work\n');
    expect(git(f.remote, 'rev-parse', 'main')).toBe(head);
  }, 30_000);

  it('refuses to publish unrelated local commits even when the checkout is clean', async () => {
    const f = fixture(), remoteHead = git(f.remote, 'rev-parse', 'main');
    put(f.publisher, 'app-version.json', 'unpublished release\n'); git(f.publisher, 'add', 'app-version.json'); git(f.publisher, 'commit', '-m', 'Unrelated local release');
    const head = git(f.publisher, 'rev-parse', 'HEAD');
    expect((await run(f.publisher)).code).toBe(1);
    expect(git(f.publisher, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(f.remote, 'rev-parse', 'main')).toBe(remoteHead);
    expect(git(f.publisher, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it('aborts a conflicting recovery without losing pending commits or remote announcements', async () => {
    const f = fixture(), hook = rejectPush(f.remote);
    expect((await run(f.publisher)).code).toBe(1); unlinkSync(hook);
    const pending = git(f.publisher, 'rev-parse', 'HEAD');
    put(f.editor, paths[1], JSON.stringify({ ...announcement, sermon: { ...announcement.sermon, title: 'Someone else published this' } }) + '\n');
    git(f.editor, 'add', paths[1]); git(f.editor, 'commit', '-m', 'Another announcement'); git(f.editor, 'push', 'origin', 'main');
    const remoteHead = git(f.remote, 'rev-parse', 'main');
    expect((await run(f.publisher)).code).toBe(1);
    expect(git(f.publisher, 'rev-parse', 'HEAD')).toBe(pending);
    expect(git(f.publisher, 'status', '--porcelain')).toBe('');
    expect(git(f.remote, 'rev-parse', 'main')).toBe(remoteHead);
    expect(readdirSync(join(f.publisher, '.git')).some((name) => name.startsWith('rebase-'))).toBe(false);
  }, 30_000);

  it.each([false, true])('repairs a missing current-week archive even when latest content is unchanged (push initially fails=%s)', async (failedPush) => {
    const f = fixture(); expect((await run(f.publisher)).code).toBe(0);
    git(f.publisher, 'rm', paths[0]); git(f.publisher, 'commit', '-m', 'Remove missing archive fixture'); git(f.publisher, 'push', 'origin', 'main');
    if (failedPush) { const hook = rejectPush(f.remote); expect((await run(f.publisher)).code).toBe(1); unlinkSync(hook); }
    expect((await run(f.publisher)).code).toBe(0);
    expect(existsSync(join(f.publisher, paths[0]))).toBe(true);
    expect(blob(f.remote, 'main', paths[0])).toBe(blob(f.remote, 'main', paths[1]));
  }, 30_000);

  it('reports a remote readback mismatch even when push itself succeeded', async () => {
    const f = fixture(); configure(f.remote);
    writeFileSync(join(f.remote, 'hooks/post-receive'), `#!/bin/sh
old=$(git rev-parse refs/heads/main)
export GIT_INDEX_FILE="$PWD/readback-test-index"
git read-tree "$old"
changed=$(printf 'remote concurrent edit\\n' | git hash-object -w --stdin)
git update-index --add --cacheinfo 100644 "$changed" announcements/latest.json
tree=$(git write-tree)
next=$(printf 'Concurrent remote edit\\n' | git commit-tree "$tree" -p "$old")
git update-ref refs/heads/main "$next" "$old"
`, { mode: 0o755 });
    const result = await run(f.publisher);
    expect(result.code).toBe(1);
    expect(result.output).toContain('PUBLISH_READBACK_MISMATCH');
    expect(blob(f.remote, 'main', paths[1])).toBe('remote concurrent edit\n');
    expect(JSON.parse(blob(f.publisher, 'HEAD', paths[1])).week).toBe(announcement.week);
  }, 30_000);

  it('refuses a different branch without writing or publishing', async () => {
    const f = fixture(), head = git(f.publisher, 'rev-parse', 'HEAD'); git(f.publisher, 'switch', '-c', 'unrelated-work');
    expect((await run(f.publisher)).code).toBe(1);
    expect(git(f.publisher, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(f.publisher, 'status', '--porcelain')).toBe('');
    expect(git(f.remote, 'rev-parse', 'main')).toBe(head);
  }, 30_000);

  it('keeps dry-run read-only even with unrelated work and an unreachable remote', async () => {
    const f = fixture(); put(f.publisher, 'README.md', 'unfinished\n'); git(f.publisher, 'remote', 'set-url', 'origin', join(f.root, 'missing.git'));
    const head = git(f.publisher, 'rev-parse', 'HEAD'), status = git(f.publisher, 'status', '--porcelain');
    const result = await run(f.publisher, announcement, true);
    expect(result.code).toBe(0); expect(JSON.parse(result.output).week).toBe(announcement.week);
    expect(git(f.publisher, 'rev-parse', 'HEAD')).toBe(head); expect(git(f.publisher, 'status', '--porcelain')).toBe(status);
    expect(existsSync(join(f.publisher, paths[0]))).toBe(false);
  }, 30_000);
});
