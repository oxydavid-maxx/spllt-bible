import { inflateRawSync } from 'node:zlib';

/**
 * The sideloaded release APK is downloaded whole, so its size is the install experience. 0.5.11 and
 * 0.5.12 went out at 162 MB: four native library sets (two of them emulator-only x86) were 118 MB
 * of it. The build now defaults a release APK to the two ARM sets with compressed native libraries
 * and runs this check on the result; uncompressed, the two ARM sets alone exceed the budget.
 */

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
}

export interface ApkBudget {
  /** The native ABIs the APK must carry, and the only ones it may. */
  abis: string[];
  /** Largest acceptable APK file size in bytes. */
  maxBytes?: number;
}

const megabytes = (bytes: number) => (bytes / 1e6).toFixed(1);

export function checkApkBudget(entries: ZipEntryInfo[], totalBytes: number, budget: ApkBudget): string[] {
  const problems: string[] = [];
  const shipped = new Set(entries.map((entry) => entry.name.match(/^lib\/([^/]+)\//)?.[1]).filter((abi): abi is string => Boolean(abi)));
  for (const abi of [...shipped].sort()) if (!budget.abis.includes(abi)) problems.push(`unexpected native ABI ${abi}`);
  for (const abi of budget.abis) if (!shipped.has(abi)) problems.push(`missing native ABI ${abi}`);
  const maps = entries.filter((entry) => entry.name.endsWith('.map'));
  if (maps.length > 0) problems.push(`${maps.length} source map file(s) shipped, e.g. ${maps[0].name}`);
  if (budget.maxBytes !== undefined && totalBytes > budget.maxBytes) {
    problems.push(`APK is ${megabytes(totalBytes)} MB, over the ${megabytes(budget.maxBytes)} MB budget`);
  }
  return problems;
}

/**
 * Whether the APK carries the Firebase app the build staged. A push token needs it at run time and
 * nothing fails at build time without it: 0.5.11–0.5.18 shipped without it and no phone registered.
 * aapt stores resource strings as UTF-8 or UTF-16, so both are looked for.
 */
export function checkFirebaseConfig(resources: Buffer | null, appId: string | null): string[] {
  if (!appId) return ['no android/app/google-services.json was staged, so push notifications cannot work'];
  if (resources && [Buffer.from(appId, 'utf8'), Buffer.from(appId, 'utf16le')].some((form) => resources.includes(form))) return [];
  return ['APK resources lack the Firebase app id from android/app/google-services.json (is the com.google.gms.google-services Gradle plugin applied?)'];
}

/** One file's bytes from a zip, stored or deflated, or null when the zip has no such file. */
export function readZipEntry(zip: Buffer, wanted: string): Buffer | null {
  const endSignature = 0x06054b50;
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === endSignature) { end = at; break; }
  }
  if (end < 0) throw new Error('not a zip file: no end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === wanted) {
      const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(start, start + compressedSize);
      return method === 8 ? inflateRawSync(data) : Buffer.from(data);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** Lists an APK's files from its zip central directory (no zip64: an APK stays far below 4 GB). */
export function readZipEntries(zip: Buffer): ZipEntryInfo[] {
  const endSignature = 0x06054b50;
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === endSignature) { end = at; break; }
  }
  if (end < 0) throw new Error('not a zip file: no end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries: ZipEntryInfo[] = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central directory entry ${index}`);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    entries.push({ name: zip.toString('utf8', at + 46, at + 46 + nameLength), compressedSize });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
