import { inflateRawSync } from 'node:zlib';

/**
 * Enough of ZIP to read a .pptx or an .xlsx, which are both zips of XML.
 *
 * Written rather than installed because the app has no zip dependency and this needs about forty
 * lines: find the central directory, walk it, and inflate the entries asked for. Adding a package to
 * the app's dependency tree for a build-time script would be the expensive way round.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

export interface ZipEntry { name: string; method: number; compressedSize: number; localOffset: number }

/** The central directory, which is the only index a zip has. */
export function listZipEntries(buffer: Buffer): ZipEntry[] {
  // The end record is last but carries a variable-length comment, so it is found by scanning back.
  let end = -1;
  for (let at = buffer.length - 22; at >= 0; at -= 1) {
    if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) { end = at; break; }
  }
  if (end < 0) return [];

  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count && at + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL_FILE_HEADER) break;
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    entries.push({
      name: buffer.toString('utf8', at + 46, at + 46 + nameLength),
      method, compressedSize, localOffset,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * One entry's bytes.
 *
 * The name and extra lengths are re-read from the LOCAL header rather than reused from the central
 * one: the two are allowed to differ, and trusting the central copy is the classic way to land a
 * few bytes into the middle of the data.
 */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
  const at = entry.localOffset;
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== 0x04034b50) return null;
  const nameLength = buffer.readUInt16LE(at + 26);
  const extraLength = buffer.readUInt16LE(at + 28);
  const start = at + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) { try { return inflateRawSync(raw); } catch { return null; } }
  return null;
}

/** Read one named file out of a zip, or null if it is absent or unreadable. */
export function readZipFile(buffer: Buffer, name: string): Buffer | null {
  const entry = listZipEntries(buffer).find((candidate) => candidate.name === name);
  return entry ? readZipEntry(buffer, entry) : null;
}

/** Read every entry whose name matches, in the order the central directory lists them. */
export function readZipMatching(buffer: Buffer, matches: (name: string) => boolean): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = [];
  for (const entry of listZipEntries(buffer)) {
    if (!matches(entry.name)) continue;
    const data = readZipEntry(buffer, entry);
    if (data) out.push({ name: entry.name, data });
  }
  return out;
}
