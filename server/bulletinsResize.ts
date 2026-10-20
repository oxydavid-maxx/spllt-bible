import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { bulletinListWidth } from '../src/domain/bulletinWidths';
import { jpegSize, readBulletinPage } from './bulletins';
import { jimpPath as installedJimp } from './bulletinsImage';

/**
 * Phone copies of the 主堂週刊 pages (2026-10-20). The 10/18 pages came in at 2481 × 3509, about three times what a phone
 * list shows, and on LTE the list stayed white for 2–5 s (Pixel, 0.5.35). The app's list asks for `?w=<width>`; this
 * cuts the page down to the nearest of BULLETIN_LIST_WIDTHS (src/domain/bulletinWidths.ts) once and keeps the copy
 * beside the page as <index>.w<width>.jpg. Full screen asks without `?w` and gets the original, as every app before
 * this one does.
 *
 * - The image work runs in a worker thread, one page at a time: decoding an A4 page in JavaScript takes about a
 *   second, which would otherwise stop every other request for that long. Nothing stays running between copies.
 * - A copy is written beside the page and swapped in, so a reader never gets half a file. When the page itself is
 *   replaced while its copy is being made (the Sunday posted again, server/bulletins.ts), the copy is not kept.
 * - A page already as narrow as the copy, a backend folder without the image tools (server/bulletinsImage.ts) and a
 *   page that cannot be decoded all get the original: the list is slower, never empty.
 */
export interface BulletinPhoneCopyOptions {
  log?: (line: string) => void;
  /** Where jimp-compact is installed (tests replace it to act out a folder without it). */
  jimpPath?: () => string;
  timeoutMs?: number;
}

const QUALITY = 80;
// CommonJS, run by worker_threads with eval: decode, cut to the width (height follows), encode as JPEG.
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const Jimp = require(workerData.jimp);
Jimp.read(Buffer.from(workerData.bytes))
  .then((image) => image.resize(workerData.width, Jimp.AUTO).quality(workerData.quality).getBufferAsync(Jimp.MIME_JPEG))
  .then((bytes) => parentPort.postMessage({ bytes }), (error) => parentPort.postMessage({ error: String((error && error.message) || error) }));
`;

export function createBulletinPhoneCopies(dir: string | undefined, options: BulletinPhoneCopyOptions = {}) {
  const log = options.log ?? ((line: string) => console.log(line));
  const timeoutMs = options.timeoutMs ?? 30_000;
  // undefined until first needed; null when the image tools are not installed (looked up once).
  let jimp: string | null | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const making = new Map<string, Promise<Uint8Array>>();
  // Copies that could not be made, by page file identity: not tried again until the page changes.
  const failed = new Set<string>();

  const oneAtATime = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  const shrink = (bytes: Uint8Array, width: number) => new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(WORKER, { eval: true, workerData: { jimp, bytes, width, quality: QUALITY } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('timed out')); }, timeoutMs);
    worker.once('message', (message: { bytes?: Uint8Array; error?: string }) => {
      clearTimeout(timer);
      if (message.bytes) resolve(new Uint8Array(message.bytes)); else reject(new Error(message.error ?? 'no copy'));
    });
    worker.once('error', (error) => { clearTimeout(timer); reject(error); });
    worker.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`worker exited ${code}`)); });
  });

  const identity = (file: string) => { try { const stat = statSync(file); return `${file}|${stat.size}|${stat.mtimeMs}`; } catch { return null; } };

  return {
    /**
     * The page as a phone copy `width` px wide (rounded to the backend's widths) or, when there is no copy to give,
     * the original; null when there is no such page.
     */
    async page(date: string, index: number, width: number | null): Promise<Uint8Array | null> {
      const original = readBulletinPage(dir, date, index);
      if (!dir || !original) return null;
      const target = width === null ? null : bulletinListWidth(width);
      const size = jpegSize(original);
      if (!target || !size || size.width <= target) return original;
      const copyFile = join(dir, date, `${index}.w${target}.jpg`);
      try { return readFileSync(copyFile); } catch { /* not made yet */ }
      const pending = making.get(copyFile);
      if (pending) return pending;
      if (jimp === undefined) {
        try { jimp = (options.jimpPath ?? installedJimp)(); } catch { jimp = null; log('BULLETIN_PHONE_COPY_UNAVAILABLE'); }
      }
      const pageFile = join(dir, date, `${index}.jpg`);
      const before = identity(pageFile);
      if (!jimp || !before || failed.has(`${before}|${target}`)) return original;
      const job = oneAtATime(() => shrink(original, target)).then((copy) => {
        // Kept only while the page is still the one it was made from.
        if (identity(pageFile) === before) {
          const partial = join(dir, date, `.${index}.w${target}.${randomUUID()}.partial`);
          try { writeFileSync(partial, copy); renameSync(partial, copyFile); } catch { rmSync(partial, { force: true }); }
        }
        return copy;
      }, () => {
        failed.add(`${before}|${target}`);
        log(`BULLETIN_PHONE_COPY_FAILED date=${date} page=${index}`);
        return original;
      }).finally(() => making.delete(copyFile));
      making.set(copyFile, job);
      return job;
    },
  };
}
