import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportCommand, outputDir, parseArgs, publishCommand, runOtaUpdate, shellLine, type Runner } from '../../scripts/ota/ota-update';
import { inspectHermesBytecode, verifyOtaExport } from '../../scripts/ota/verify-ota-bundle';

// The gate in front of every EAS Update (docs/eas-update.md). 2026-10-20: @expo/cli 56.1.25 renamed the DOM
// component html inside compiled Hermes bytecode; hermesc had packed "2026-10-06" against that name, the rename
// overwrote the shared byte, and the first preview OTA crashed on launch (expo/expo#49626). These fixtures are
// compiled by the same hermesc and the same @expo/metro-config step that `expo export` uses.
const require = createRequire(import.meta.url);
const { buildHermesBundleAsync } = require('@expo/metro-config/build/serializer/exportHermes') as {
  buildHermesBundleAsync: (options: { projectRoot: string; code: string; map: string | null; minify: boolean; filename: string }) => Promise<{ hbc: Buffer }>;
};
const md5 = (value: string) => createHash('md5').update(value).digest('hex');

// A DOM component reference whose placeholder starts with "6", so hermesc packs "2026-10-06" against it.
const reference = Array.from({ length: 200 }, (_, index) => `file:///fixture/dom/widget-${index}.js`).find((ref) => md5(ref).startsWith('6'))!;
const placeholder = `${md5(reference)}.html`;
const html = '<!doctype html><html><body>fixture dom component</body></html>';
const finalName = `${md5(html)}.html`;
const plan = {
  days: [
    { date: '2026-10-01', references: ['JHN.1'], source_rows: ['約1章'] },
    { date: '2026-10-06', references: ['PSA.119.1-88'], source_rows: ['詩119:1-88'] },
  ],
};
const source = (htmlName: string) =>
  `globalThis.plan = ["2026-10-01", "2026-10-06", "JHN.1", "PSA.119.1-88", "約1章", "詩119:1-88"];\nglobalThis.dom = ${JSON.stringify(htmlName)};\n`;
const compile = async (code: string) => (await buildHermesBundleAsync({ projectRoot: process.cwd(), code, map: null, minify: true, filename: 'fixture.js' })).hbc;

/** What @expo/cli 56.1.25 did to compiled bytecode (transformNativeBundleForMd5Filename, Buffer branch). */
function legacyRenameInBytecode(bytes: Buffer, search: string, replace: string): Buffer {
  const copy = Buffer.from(bytes);
  const searchBuffer = Buffer.from(search, 'utf8');
  const replaceBuffer = Buffer.from(replace, 'utf8');
  for (let index = copy.indexOf(searchBuffer); index !== -1; index = copy.indexOf(searchBuffer, index + searchBuffer.length)) replaceBuffer.copy(copy, index);
  return copy;
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function writeExport(bytes: Buffer, htmlFiles: Record<string, string> = { [finalName]: html }, platform = 'android'): string {
  const root = mkdtempSync(join(tmpdir(), 'ota-gate-'));
  roots.push(root);
  const bundle = `_expo/static/js/${platform}/entry-fixture.hbc`;
  mkdirSync(dirname(join(root, bundle)), { recursive: true });
  writeFileSync(join(root, bundle), bytes);
  mkdirSync(join(root, 'www.bundle'), { recursive: true });
  for (const [name, contents] of Object.entries(htmlFiles)) writeFileSync(join(root, 'www.bundle', name), contents);
  const assets = Object.keys(htmlFiles).map((name) => ({ path: `www.bundle/${name}`, ext: 'html' }));
  writeFileSync(join(root, 'metadata.json'), JSON.stringify({ version: 0, bundler: 'metro', fileMetadata: { [platform]: { bundle, assets } } }));
  return root;
}
const failed = (root: string) => verifyOtaExport(root, { platforms: ['android'], plan }).filter((check) => !check.ok);

describe('OTA bytecode gate (scripts/ota/verify-ota-bundle.ts)', () => {
  it('passes bytecode compiled from JS that already carries the content-hashed html name', async () => {
    const checks = verifyOtaExport(writeExport(await compile(source(finalName))), { platforms: ['android'], plan });
    expect(checks.map((check) => [check.name, check.ok])).toEqual([
      ['bytecode 未被改寫', true], ['讀經計畫 2 個日期', true], ['讀經計畫 4 個章節字串', true], ['網頁元件 html', true],
    ]);
  }, 60_000);

  it('blocks the 56.1.25 export: the html rename inside compiled bytecode clobbers 2026-10-06', async () => {
    const compiled = await compile(source(placeholder));
    expect(compiled.includes(`2026-10-0${placeholder}`), 'hermesc packs the date against the placeholder').toBe(true);
    const shipped = legacyRenameInBytecode(compiled, placeholder, finalName);
    expect(shipped.includes('2026-10-06')).toBe(false);
    const problems = failed(writeExport(shipped));
    expect(problems.map((check) => check.name)).toEqual(['bytecode 未被改寫', '讀經計畫 2 個日期']);
    expect(problems[0].detail).toContain('在 hermesc 編完之後被改寫過');
    expect(problems[1].detail).toContain(`「2026-10-06」找不到；bytecode 裡「2026-10-0」直接接著網頁元件檔名 ${finalName}`);
  }, 60_000);

  it('fails any byte edited after hermesc, and anything that is not Hermes bytecode', async () => {
    const clean = await compile(source(finalName));
    expect(inspectHermesBytecode(clean)).toMatchObject({ hermes: true, intact: true });
    const edited = Buffer.from(clean);
    edited[Math.floor(edited.length / 2)] ^= 0x01;
    expect(inspectHermesBytecode(edited)).toMatchObject({ hermes: true, intact: false });
    expect(failed(writeExport(edited)).map((check) => check.name)).toContain('bytecode 未被改寫');
    expect(failed(writeExport(Buffer.from(source(finalName))))).toEqual([expect.objectContaining({ name: 'Hermes bytecode' })]);
  }, 60_000);

  it('requires every html the bytecode names to be exported under its own content md5', async () => {
    // Never renamed: the bytecode still points at the placeholder, which expo-updates cannot serve.
    const unrenamed = failed(writeExport(await compile(source(placeholder))));
    expect(unrenamed.map((check) => check.detail).join()).toContain(`bytecode 指向 ${placeholder}，但這次沒有匯出這個檔`);
    // The html changed after it was named.
    const stale = failed(writeExport(await compile(source(finalName)), { [finalName]: `${html}<!-- edited -->` }));
    expect(stale.map((check) => check.detail).join()).toContain('檔名不符');
  }, 60_000);

  it('fails closed without metadata.json or without the requested platform', () => {
    const empty = mkdtempSync(join(tmpdir(), 'ota-gate-'));
    roots.push(empty);
    expect(verifyOtaExport(empty, { plan })).toEqual([expect.objectContaining({ name: 'metadata.json', ok: false })]);
    const iosOnly = writeExport(Buffer.alloc(0), {}, 'ios');
    expect(verifyOtaExport(iosOnly, { platforms: ['android'], plan })).toEqual([expect.objectContaining({ name: 'bundle', ok: false })]);
  });
});

describe('OTA update wrapper (scripts/ota/ota-update.ts): no push unless the gate passes', () => {
  function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'ota-update-'));
    roots.push(root);
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'reading-plan-2026.json'), JSON.stringify(plan));
    return root;
  }
  function fakeEas(root: string, bytes: Buffer, calls: Array<{ command: string[]; noDotenv?: string }>): Runner {
    return (command, env) => {
      calls.push({ command, noDotenv: env.EXPO_NO_DOTENV });
      if (command.includes('export') || command.includes('env:exec')) {
        const dir = join(root, outputDir('android'));
        const bundle = '_expo/static/js/android/entry-fixture.hbc';
        mkdirSync(dirname(join(dir, bundle)), { recursive: true });
        mkdirSync(join(dir, 'www.bundle'), { recursive: true });
        writeFileSync(join(dir, bundle), bytes);
        writeFileSync(join(dir, 'www.bundle', finalName), html);
        writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ version: 0, bundler: 'metro', fileMetadata: { android: { bundle, assets: [{ path: `www.bundle/${finalName}`, ext: 'html' }] } } }));
      }
      return 0;
    };
  }
  const options = { platform: 'android' as const, message: 'preview 測試', publish: true, localEnv: false };

  it('exports with the EAS production variables, gates, then pushes that same folder to preview', async () => {
    const root = project();
    const calls: Array<{ command: string[]; noDotenv?: string }> = [];
    expect(runOtaUpdate(root, options, fakeEas(root, await compile(source(finalName)), calls), () => {})).toBe(0);
    expect(calls.map((call) => call.command)).toEqual([
      ['npx', 'eas-cli@24.13.0', 'env:exec', 'production', shellLine(exportCommand('android')), '--non-interactive'],
      publishCommand(options),
    ]);
    expect(calls.every((call) => call.noDotenv === '1')).toBe(true);
    expect(publishCommand(options)).toEqual(['npx', 'eas-cli@24.13.0', 'update', '--skip-bundler', '--input-dir', 'dist/ota-android', '--platform', 'android',
      '--channel', 'preview', '--environment', 'production', '--message', 'preview 測試', '--non-interactive', '--json']);
    expect(exportCommand('android')).toEqual(['npx', 'expo', 'export', '--platform', 'android', '--output-dir', 'dist/ota-android', '--dump-sourcemap', '--dump-assetmap', '--clear']);
  }, 60_000);

  it('never calls eas update when the gate fails', async () => {
    const root = project();
    const calls: Array<{ command: string[] }> = [];
    const corrupted = legacyRenameInBytecode(await compile(source(placeholder)), placeholder, finalName);
    const log: string[] = [];
    expect(runOtaUpdate(root, options, fakeEas(root, corrupted, calls), (line) => log.push(line))).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).not.toContain('update');
    expect(log.join('\n')).toContain('不要推這份匯出');
  }, 60_000);

  it('does not push without --publish, nor ever from a --local-env export', async () => {
    const root = project();
    const bytes = await compile(source(finalName));
    for (const variant of [{ publish: false, localEnv: false }, { publish: true, localEnv: true }]) {
      const calls: Array<{ command: string[] }> = [];
      expect(runOtaUpdate(root, { ...options, ...variant }, fakeEas(root, bytes, calls), () => {})).toBe(0);
      expect(calls).toHaveLength(1);
      expect(calls[0].command).not.toContain('update');
    }
  }, 60_000);

  it('takes one platform per run and keeps the message safe for the shell', () => {
    expect(parseArgs(['--platform', 'all', '--message', 'x'])).toContain('兩個平台分開推');
    expect(parseArgs(['--platform', 'ios'])).toBe('--message 必填');
    expect(parseArgs(['--platform', 'ios', '--message', 'say "hi"'])).toContain('不可含');
    expect(parseArgs(['--platform', 'ios', '--message', '修正 10/06 日期', '--publish'])).toEqual({ platform: 'ios', message: '修正 10/06 日期', publish: true, localEnv: false });
    expect(shellLine(['npx', 'eas-cli@24.13.0', '--message', '修正 日期'])).toBe('npx eas-cli@24.13.0 --message "修正 日期"');
  });
});
