import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkApkBudget, readZipEntries } from '../../src/config/apkBudget';
import { checkDownloadHref, checkUpdateNotice } from '../../src/config/installLink';
import { findWorktreesSharingNodeModules, syncDeps } from '../../src/config/depsSync';

// Three basics that came back more than once (2026-09-26), each guarded where it would recur.

/** A minimal stored (uncompressed) zip with the given files, enough for the central directory reader. */
function makeZip(files: Array<[string, number]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, size] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.alloc(size);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + size;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

describe('the sideloaded APK stays small', () => {
  // 0.5.11 and 0.5.12 shipped 162 MB: an ARM-only APK had crashed on the x86_64 test emulator, so
  // the emulator-only x86 sets were added back, and four ABIs were 118 MB of it. A release APK now
  // carries the two ARM sets compressed (the emulator runs that too), and the build fails when
  // another ABI, a source map, or excess size slips in.
  it('reads the files and sizes an APK contains', () => {
    const entries = readZipEntries(makeZip([['lib/arm64-v8a/libhermes.so', 40], ['assets/app.js', 10]]));
    expect(entries).toEqual([{ name: 'lib/arm64-v8a/libhermes.so', compressedSize: 40 }, { name: 'assets/app.js', compressedSize: 10 }]);
  });

  it('accepts an ARM APK without source maps under the budget', () => {
    const entries = [
      { name: 'lib/arm64-v8a/libhermes.so', compressedSize: 40 },
      { name: 'lib/armeabi-v7a/libhermes.so', compressedSize: 30 },
      { name: 'assets/www.bundle/entry.js', compressedSize: 10 },
    ];
    expect(checkApkBudget(entries, 70e6, { abis: ['arm64-v8a', 'armeabi-v7a'], maxBytes: 90e6 })).toEqual([]);
  });

  it('names every emulator library set, missing phone set, shipped source map, and excess megabyte', () => {
    const entries = [
      { name: 'lib/arm64-v8a/libhermes.so', compressedSize: 40 },
      { name: 'lib/x86/libhermes.so', compressedSize: 40 },
      { name: 'lib/x86_64/libhermes.so', compressedSize: 40 },
      { name: 'assets/www.bundle/entry.js.map', compressedSize: 10 },
    ];
    const problems = checkApkBudget(entries, 162.4e6, { abis: ['arm64-v8a', 'armeabi-v7a'], maxBytes: 90e6 });
    expect(problems).toEqual([
      'unexpected native ABI x86',
      'unexpected native ABI x86_64',
      'missing native ABI armeabi-v7a',
      '1 source map file(s) shipped, e.g. assets/www.bundle/entry.js.map',
      'APK is 162.4 MB, over the 90.0 MB budget',
    ]);
  });

  it('builds release APKs for ARM phones with compressed native libraries unless told otherwise, and checks the result', () => {
    const script = readFileSync('scripts/build-android.ps1', 'utf8');
    expect(script).toMatch(/if \(-not \$ReactNativeArchitectures\) \{ \$ReactNativeArchitectures = 'arm64-v8a,armeabi-v7a' \}/);
    expect(script).toMatch(/if \(-not \$PSBoundParameters\.ContainsKey\('LegacyPackaging'\)\) \{ \$LegacyPackaging = \[switch\]\$true \}/);
    expect(script).toMatch(/scripts\/check-apk-budget\.ts/);
  });
});

describe('the install page downloads the APK itself', () => {
  // A github.com download link opened the GitHub app's sign-in screen on phones that have it, with
  // a Chrome/淘寶 chooser, instead of downloading. The page links an APK next to itself.
  const page = 'https://home.luminexhealthbiohack.com/public/jhuke-bible/';

  it('accepts an APK served next to the page', () => {
    expect(checkDownloadHref(page, 'assets/jhuke-bible-0.5.13.apk')).toEqual([]);
  });

  // 2026-09-26: the notice every installed app reads still named 0.5.9 six releases later, so
  // nobody was told to update. Publishing is not done until it names this release and the page.
  it('requires the update notice to announce this release and point at the install page', () => {
    expect(checkUpdateNotice({ versionCode: 37, url: page }, { versionCode: 37, pageUrl: page })).toEqual([]);
    expect(checkUpdateNotice({ versionCode: 30, url: 'https://github.com/oxydavid-maxx/spllt-bible/releases/download/x/app.apk' }, { versionCode: 37, pageUrl: page })).toEqual([
      'the update notice announces versionCode 30, not this release\'s 37',
      `the update notice points at https://github.com/oxydavid-maxx/spllt-bible/releases/download/x/app.apk, not the install page ${page}`,
    ]);
    expect(checkUpdateNotice(null, { versionCode: 37, pageUrl: page })).toEqual(['the update notice (announcements/app-version.json) is missing or unreadable']);
  });

  it('refuses a GitHub link, another site, or something that is not an APK', () => {
    expect(checkDownloadHref(page, 'https://github.com/oxydavid-maxx/spllt-bible/releases/download/x/app.apk')).toEqual(['download link leaves the page\'s site (github.com)']);
    expect(checkDownloadHref(page, 'https://example.com/public/jhuke-bible/assets/a.apk')).toEqual(['download link leaves the page\'s site (example.com)']);
    expect(checkDownloadHref(page, 'assets/readme.txt')).toEqual(['download link is not an .apk file']);
  });
});

describe('a dependency reinstall never pulls packages out from under a running backend', () => {
  // 2026-09-26: npm ci wiped the build tree's node_modules while the production backend used it
  // through a junction. It survived only on modules already in memory.
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  function layout() {
    const base = mkdtempSync(join(tmpdir(), 'qm-deps-'));
    roots.push(base);
    const project = join(base, 'project');
    mkdirSync(join(project, 'node_modules'), { recursive: true });
    mkdirSync(join(project, 'patches'));
    writeFileSync(join(project, 'package-lock.json'), '{}');
    const worktrees = join(base, 'worktrees');
    mkdirSync(join(worktrees, 'backend-live'), { recursive: true });
    mkdirSync(join(worktrees, 'backend-own', 'node_modules'), { recursive: true });
    return { project, worktrees };
  }

  it('finds a worktree whose node_modules is a link to the build tree', () => {
    const { project, worktrees } = layout();
    symlinkSync(join(project, 'node_modules'), join(worktrees, 'backend-live', 'node_modules'), 'junction');
    expect(findWorktreesSharingNodeModules(project, worktrees)).toEqual([join(worktrees, 'backend-live')]);
  });

  it('refuses to reinstall while one does, and reinstalls when none does', () => {
    const { project, worktrees } = layout();
    symlinkSync(join(project, 'node_modules'), join(worktrees, 'backend-live', 'node_modules'), 'junction');
    const npmCi = vi.fn();
    expect(() => syncDeps(project, { npmCi, sharedWorktreesDir: worktrees })).toThrow(/backend-live/);
    expect(npmCi).not.toHaveBeenCalled();

    rmSync(join(worktrees, 'backend-live', 'node_modules'));
    syncDeps(project, { npmCi, sharedWorktreesDir: worktrees });
    expect(npmCi).toHaveBeenCalledOnce();
  });
});
