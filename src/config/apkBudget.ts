/**
 * The sideloaded release APK is downloaded whole, so its size is the install experience. 0.5.11 and
 * 0.5.12 went out at 162 MB because the ARM-only build argument was manual and got dropped: four
 * native library sets (two of them emulator-only x86) were 118 MB of it. The build now defaults a
 * release APK to arm64-v8a and runs this check on the result.
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
