import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectHermesBytecode } from '../../scripts/ota/verify-ota-bundle';

// patches/expo++@expo+cli+56.1.25.patch and patches/@expo+metro-config+56.0.19.patch backport expo/expo#49627:
// chunks that reference DOM components are compiled to Hermes bytecode only after the html rename has been
// applied to their JS, and @expo/cli no longer rewrites compiled bytecode. These run the installed (patched)
// toolchain. When an Expo upgrade ships the upstream fix, delete both patches and keep these tests: they must
// still pass on the upstream code (docs/eas-update.md「上游修好後」).
const require = createRequire(import.meta.url);
const cliRoot = dirname(require.resolve('@expo/cli/package.json', { paths: [dirname(require.resolve('expo/package.json'))] }));
const { transformNativeBundleForMd5Filename } = require(join(cliRoot, 'build/src/export/exportDomComponents.js'));
// Loaded inside the test: without the fix the module does not exist, and that one test should say so.
const compileDeferredHermesArtifactsAsync = (options: unknown) => require(join(cliRoot, 'build/src/export/compileDeferredHermesArtifacts.js')).compileDeferredHermesArtifactsAsync(options);
const { buildHermesBundleAsync } = require('@expo/metro-config/build/serializer/exportHermes');
const serializeChunksSource = readFileSync(require.resolve('@expo/metro-config/build/serializer/serializeChunks'), 'utf8');

const md5 = (value: string) => createHash('md5').update(value).digest('hex');
const reference = Array.from({ length: 200 }, (_, index) => `file:///fixture/dom/widget-${index}.js`).find((ref) => md5(ref).startsWith('6'))!;
const htmlOutputName = `www.bundle/${md5(reference)}.html`;
const html = '<!doctype html><html><body>fixture dom component</body></html>';
const finalName = `${md5(html)}.html`;
const code = `globalThis.plan = ["2026-10-01", "2026-10-06"];\nglobalThis.dom = ${JSON.stringify(`${md5(reference)}.html`)};\n`;

type FileEntry = { contents: string | Buffer; originFilename?: string };
function nativeBundle(contents: string | Buffer, deferred: boolean) {
  const filename = `_expo/static/js/android/entry-fixture.${typeof contents === 'string' ? 'js' : 'hbc'}`;
  const artifact = {
    filename, originFilename: 'index.js', type: 'js', source: contents,
    metadata: { expoDomComponentReferences: [reference], ...(deferred ? { deferredHermesBytecode: true } : {}), paths: {} },
  };
  const files = new Map<string, FileEntry>([[filename, { contents, originFilename: 'index.js' }], [htmlOutputName, { contents: html }]]);
  return { artifact, files };
}

describe('Expo export toolchain renames DOM html before Hermes compiles (expo/expo#49627 backport)', () => {
  it('the serializer defers DOM chunks instead of compiling them inline', () => {
    expect(serializeChunksSource).toContain('jsAsset.metadata.deferredHermesBytecode = true');
    expect(serializeChunksSource).toContain('exports.transformJsAssetToHermesBytecodeAsync');
  });

  it('refuses to rename inside a DOM chunk that was already compiled, and leaves other bytecode alone', async () => {
    const { hbc } = await buildHermesBundleAsync({ projectRoot: process.cwd(), code, map: null, minify: true, filename: 'fixture.js' });
    const compiled = nativeBundle(Buffer.from(hbc), false);
    expect(() => transformNativeBundleForMd5Filename({ domComponentReference: reference, nativeBundle: { artifacts: [compiled.artifact] }, files: compiled.files, htmlOutputName }))
      .toThrow(/Cannot rename DOM component asset/);
    const worker = nativeBundle(Buffer.from(hbc), false);
    worker.artifact.metadata.expoDomComponentReferences = [];
    transformNativeBundleForMd5Filename({ domComponentReference: reference, nativeBundle: { artifacts: [worker.artifact] }, files: worker.files, htmlOutputName });
    expect(Buffer.compare(worker.files.get(worker.artifact.filename)!.contents as Buffer, hbc)).toBe(0);
  }, 60_000);

  it('renames the html in the JS, then compiles intact bytecode that keeps 2026-10-06', async () => {
    const { artifact, files } = nativeBundle(code, true);
    transformNativeBundleForMd5Filename({ domComponentReference: reference, nativeBundle: { artifacts: [artifact] }, files, htmlOutputName });
    await compileDeferredHermesArtifactsAsync({ projectRoot: process.cwd(), artifacts: [artifact], files });
    expect(artifact.filename).toBe('_expo/static/js/android/entry-fixture.hbc');
    expect(artifact.metadata).not.toHaveProperty('deferredHermesBytecode');
    expect(files.has('_expo/static/js/android/entry-fixture.js')).toBe(false);
    const bytes = files.get(artifact.filename)!.contents as Buffer;
    expect(inspectHermesBytecode(bytes)).toMatchObject({ hermes: true, intact: true });
    expect(bytes.includes('2026-10-06')).toBe(true);
    expect(bytes.includes(finalName)).toBe(true);
    expect(bytes.includes(`${md5(reference)}.html`)).toBe(false);
  }, 60_000);
});
