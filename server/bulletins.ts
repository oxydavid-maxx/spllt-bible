import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 主堂週刊 (維護者 2026-10-17): the church office posts the weekly bulletin to 「竹科靈糧堂訊息公布欄」 as a few
 * photos sent together. LINE marks photos sent at once with an imageSet; a bulletin is such a set of two or more
 * A4 portrait pages. Every other photo in the group is looked at for its size only and dropped at once: not
 * stored, and logged without anything that identifies it. The bot never posts.
 *
 * Saved under <dir>/<Sunday>/ (1.jpg, 2.jpg, … and meta.json), dated by the Sunday on or after the post (Taipei);
 * a second set for the same Sunday replaces the first. The newest 8 Sundays are kept.
 */
export interface BulletinPage { index: number; width: number; height: number }
export interface BulletinWeek { date: string; postedAt: string; pages: BulletinPage[] }
export interface LineImage { messageId: string; timestamp: number; imageSet?: { id: string; index?: number; total?: number } }

export const KEEP_WEEKS = 8;
const MIN_PAGES = 2;
const MIN_WIDTH = 600;
// A4 is 297 / 210 = 1.414; a phone photo of a page or a scan with a margin lands a little either side.
const A4_MIN = 1.36;
const A4_MAX = 1.47;
// A set whose sender's phone leaves out the total (LINE for Android 11.15 and earlier) is closed after this quiet time.
const OPEN_SET_MS = 120_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Width and height from a JPEG's frame header; null for anything else. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

export function isA4Portrait(width: number, height: number): boolean {
  return width >= MIN_WIDTH && height / width >= A4_MIN && height / width <= A4_MAX;
}

/** The Sunday on or after the moment of posting, in Taipei. */
export function bulletinSunday(postedAtMs: number): string {
  const taipei = new Date(postedAtMs + 8 * 3_600_000);
  const day = taipei.getUTCDay();
  return new Date(Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate() + ((7 - day) % 7))).toISOString().slice(0, 10);
}

interface OpenSet { firstAt: number; total?: number; received: number; misfit: boolean; pages: Array<{ index: number; bytes: Uint8Array; width: number; height: number }>; timer?: ReturnType<typeof setTimeout> }

export interface BulletinCollectorOptions {
  dir: string;
  /** Downloads a LINE message's content (server/lineContent.ts). */
  fetchContent: (messageId: string) => Promise<Uint8Array>;
  log?: (line: string) => void;
  keepWeeks?: number;
  /** For tests: closes a set that never says how many photos it has. */
  schedule?: (run: () => void, ms: number) => ReturnType<typeof setTimeout> | void;
}

export function createBulletinCollector(options: BulletinCollectorOptions) {
  const log = options.log ?? ((line: string) => console.log(line));
  const keepWeeks = options.keepWeeks ?? KEEP_WEEKS;
  const schedule = options.schedule ?? ((run: () => void, ms: number) => { const timer = setTimeout(run, ms); (timer as { unref?: () => void }).unref?.(); return timer; });
  const open = new Map<string, OpenSet>();

  function close(id: string): void {
    const set = open.get(id);
    if (!set) return;
    open.delete(id);
    if (set.timer) clearTimeout(set.timer);
    if (set.misfit || set.pages.length < MIN_PAGES) {
      log(`LINE_IMAGE_SET_SKIPPED pages=${set.received} reason=${set.misfit ? 'SHAPE' : 'TOO_FEW'}`);
      return;
    }
    const date = bulletinSunday(set.firstAt);
    save(date, new Date(set.firstAt).toISOString(), [...set.pages].sort((a, b) => a.index - b.index));
  }

  function save(date: string, postedAt: string, pages: OpenSet['pages']): void {
    mkdirSync(options.dir, { recursive: true });
    const partial = join(options.dir, `.${date}.${randomUUID()}.partial`);
    mkdirSync(partial);
    const meta: BulletinWeek = { date, postedAt, pages: pages.map((page, position) => ({ index: position + 1, width: page.width, height: page.height })) };
    pages.forEach((page, position) => writeFileSync(join(partial, `${position + 1}.jpg`), page.bytes));
    writeFileSync(join(partial, 'meta.json'), JSON.stringify(meta));
    const target = join(options.dir, date);
    // Written beside the target and swapped in, so a reader never sees half a bulletin.
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(partial, target);
    log(`LINE_BULLETIN_SAVED date=${date} pages=${pages.length}`);
    for (const old of weekFolders(options.dir).slice(keepWeeks)) rmSync(join(options.dir, old), { recursive: true, force: true });
  }

  return {
    /** One photo from a group. Photos not sent as a set are never kept. */
    async receive(image: LineImage): Promise<void> {
      if (!image.imageSet?.id) { log('LINE_IMAGE_SKIPPED reason=SINGLE'); return; }
      const bytes = await options.fetchContent(image.messageId);
      const size = jpegSize(bytes);
      const id = image.imageSet.id;
      const set = open.get(id) ?? { firstAt: image.timestamp, received: 0, misfit: false, pages: [] };
      open.set(id, set);
      set.firstAt = Math.min(set.firstAt, image.timestamp);
      set.received += 1;
      if (image.imageSet.total) set.total = image.imageSet.total;
      if (size && isA4Portrait(size.width, size.height)) set.pages.push({ index: image.imageSet.index ?? set.received, bytes, ...size });
      else set.misfit = true;
      if (set.total && set.received >= set.total) { close(id); return; }
      if (set.timer) clearTimeout(set.timer);
      set.timer = schedule(() => close(id), OPEN_SET_MS) ?? undefined;
    },
  };
}

function weekFolders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => DATE.test(name)).sort().reverse();
}

/** Newest first; a folder whose meta.json cannot be read is left out. */
export function listBulletins(dir: string | undefined): BulletinWeek[] {
  if (!dir) return [];
  return weekFolders(dir).flatMap((date) => {
    try {
      const meta = JSON.parse(readFileSync(join(dir, date, 'meta.json'), 'utf8')) as BulletinWeek;
      return meta.date === date && Array.isArray(meta.pages) ? [{ date, postedAt: meta.postedAt, pages: meta.pages }] : [];
    } catch { return []; }
  });
}

export function readBulletinPage(dir: string | undefined, date: string, index: number): Uint8Array | null {
  if (!dir || !DATE.test(date) || !Number.isSafeInteger(index) || index < 1) return null;
  try { return readFileSync(join(dir, date, `${index}.jpg`)); } catch { return null; }
}
