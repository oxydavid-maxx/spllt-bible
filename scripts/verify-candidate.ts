import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyInputs, type InputReceipt } from '../src/config/inputs';

export interface CandidateReceipt {
  fixture: true;
  androidPackage: string;
  iosBundleIdentifier: string;
  contentMode: 'C_PENDING_ACCESS';
  sourceSha256: Record<string, string>;
  nativeSourceSha256: Record<string, string>;
  serverSourceSha256: Record<string, string>;
  forbiddenMatches: string[];
  inputReceipt: Pick<InputReceipt, 'scheduledDays' | 'uniqueChapters'>;
}

function hash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function productionFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|tsx|js|json)$/.test(entry.name)) files.push(path);
    }
  }
  for (const directory of ['app', 'src', 'server', 'data']) {
    const path = join(root, directory);
    try { await walk(path); } catch { /* optional directory */ }
  }
  return files;
}

export async function verifyCandidate(root: string): Promise<CandidateReceipt> {
  const app = JSON.parse(await readFile(join(root, 'app.json'), 'utf8')) as {
    expo?: {
      android?: { package?: string };
      ios?: { bundleIdentifier?: string };
      extra?: { fixture?: boolean; contentMode?: string };
    };
  };
  const expo = app.expo;
  if (!expo?.android?.package) throw new Error('android.package is required');
  if (!expo.ios?.bundleIdentifier) throw new Error('ios.bundleIdentifier is required');
  if (expo.extra?.fixture !== true) throw new Error('fixture marker is required for this candidate');
  if (expo.extra.contentMode !== 'C_PENDING_ACCESS') throw new Error('candidate must stay C_PENDING_ACCESS');

  const inputReceipt = await verifyInputs(join(root, 'data'));
  const files = await productionFiles(root);
  const forbiddenMatches: string[] = [];
  const forbidden = /(-----BEGIN [A-Z ]+-----|client_secret|private_key|AIza[0-9A-Za-z_-]{20,})/i;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (forbidden.test(text)) forbiddenMatches.push(file);
  }
  if (forbiddenMatches.length > 0) throw new Error(`candidate contains forbidden secret material: ${forbiddenMatches.join(', ')}`);

  const nativeConfigFiles = [
    join(root, 'android', 'gradle.properties'),
    join(root, 'android', 'settings.gradle'),
    join(root, 'android', 'build.gradle'),
    join(root, 'android', 'app', 'build.gradle'),
    join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    join(root, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'),
  ];
  const sourceFiles = [join(root, 'app.json'), join(root, 'package.json'), join(root, 'package-lock.json'), ...nativeConfigFiles, ...files];
  const serverFiles = files.filter((file) => file.split(/[\\\\/]/).includes('server'));
  const nativeFiles = sourceFiles.filter((file) => !serverFiles.includes(file));
  const sourceSha256: Record<string, string> = {};
  for (const file of sourceFiles) sourceSha256[file.slice(root.length + 1)] = hash(await readFile(file));
  const nativeSourceSha256: Record<string, string> = {};
  for (const file of nativeFiles) nativeSourceSha256[file.slice(root.length + 1)] = sourceSha256[file.slice(root.length + 1)];
  const serverSourceSha256: Record<string, string> = {};
  for (const file of serverFiles) serverSourceSha256[file.slice(root.length + 1)] = sourceSha256[file.slice(root.length + 1)];
  return {
    fixture: true,
    androidPackage: expo.android.package,
    iosBundleIdentifier: expo.ios.bundleIdentifier,
    contentMode: 'C_PENDING_ACCESS',
    sourceSha256,
    nativeSourceSha256,
    serverSourceSha256,
    forbiddenMatches,
    inputReceipt: { scheduledDays: inputReceipt.scheduledDays, uniqueChapters: inputReceipt.uniqueChapters },
  };
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const receipt = await verifyCandidate(root);
  await mkdir(join(root, 'docs', 'receipts'), { recursive: true });
  await writeFile(join(root, 'docs', 'receipts', 'candidate-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1]?.endsWith('verify-candidate.ts')) void main();
