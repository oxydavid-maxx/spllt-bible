import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 主堂週刊 (維護者 2026-10-17): the church office posts the weekly bulletin to 「竹科靈糧堂訊息公布欄」 as a few
 * A4 pages. A bulletin is two or more A4 portrait pages from one person, each within 10 minutes of the one before;
 * an A4 page the same person adds within 3 hours joins that bulletin. Every other photo is looked at for its size
 * only and dropped at once: not stored, and logged without anything that identifies it. The bot never posts.
 *
 * Checked against the group's history on 2026-10-17 (7/12–10/13, 74 photos): all 13 weekly bulletins were three
 * exact A4 pages (1722 × 2435) from the same person early on Sunday, pages within two minutes of each other, except
 * 9/27, whose third page came 46 minutes later. The other photos were posters, greetings, photos and screenshots,
 * plus two lone A4-shaped flyers from other people. LINE's own "sent together" mark cannot be seen in that history,
 * so the rule does not rely on it.
 *
 * Saved under <dir>/<Sunday>/ (1.jpg, 2.jpg, … and meta.json), dated by the Sunday on or after the first page
 * (Taipei); a later bulletin for the same Sunday replaces the earlier one. The newest 8 Sundays are kept.
 */
export interface BulletinPage { index: number; width: number; height: number }
export interface BulletinWeek { date: string; postedAt: string; pages: BulletinPage[] }
/** A photo posted in a group. The sender's LINE id is used to tell posts apart and is never stored or logged. */
export interface LineImage { messageId: string; timestamp: number; senderId?: string }

export const KEEP_WEEKS = 8;
const MIN_PAGES = 2;
const MIN_WIDTH = 600;
// A4 is 297 / 210 = 1.414; a phone photo of a page or a scan with a margin lands a little either side.
const A4_MIN = 1.36;
const A4_MAX = 1.47;
// Pages of one bulletin follow each other within this; the backtest's widest gap inside a post was about a minute.
const PAGE_GAP_MS = 10 * 60_000;
// A page the same person adds afterwards (9/27: 46 minutes) still belongs to that bulletin.
const LATE_PAGE_MS = 3 * 3_600_000;
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

interface Page { at: number; order: number; bytes: Uint8Array; width: number; height: number }
interface Post { pages: Page[]; lastAt: number; date?: string; timer?: ReturnType<typeof setTimeout> | void }

export interface BulletinCollectorOptions {
  dir: string;
  /** Downloads a LINE message's content (server/lineContent.ts). */
  fetchContent: (messageId: string) => Promise<Uint8Array>;
  log?: (line: string) => void;
  keepWeeks?: number;
  /** For tests: runs `close` once a post has been quiet for PAGE_GAP_MS. */
  schedule?: (run: () => void, ms: number) => ReturnType<typeof setTimeout> | void;
}

export function createBulletinCollector(options: BulletinCollectorOptions) {
  const log = options.log ?? ((line: string) => console.log(line));
  const keepWeeks = options.keepWeeks ?? KEEP_WEEKS;
  const schedule = options.schedule ?? ((run: () => void, ms: number) => { const timer = setTimeout(run, ms); (timer as { unref?: () => void }).unref?.(); return timer; });
  // Per sender: the post still being added to, and the last bulletin saved (late pages join it).
  const open = new Map<string, Post>();
  const saved = new Map<string, Post>();
  let order = 0;

  function close(sender: string): void {
    const post = open.get(sender);
    if (!post) return;
    open.delete(sender);
    if (post.timer) clearTimeout(post.timer);
    if (post.pages.length < MIN_PAGES) { log('LINE_IMAGE_SKIPPED reason=SINGLE'); return; }
    post.date = bulletinSunday(post.pages[0].at);
    save(post);
    saved.set(sender, post);
  }

  function save(post: Post): void {
    const pages = [...post.pages].sort((a, b) => a.at - b.at || a.order - b.order);
    const date = post.date!;
    mkdirSync(options.dir, { recursive: true });
    const partial = join(options.dir, `.${date}.${randomUUID()}.partial`);
    mkdirSync(partial);
    const meta: BulletinWeek = { date, postedAt: new Date(pages[0].at).toISOString(), pages: pages.map((page, position) => ({ index: position + 1, width: page.width, height: page.height })) };
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
    async receive(image: LineImage): Promise<void> {
      const bytes = await options.fetchContent(image.messageId);
      const size = jpegSize(bytes);
      if (!size || !isA4Portrait(size.width, size.height)) { log('LINE_IMAGE_SKIPPED reason=SHAPE'); return; }
      const sender = image.senderId ?? 'group';
      const page: Page = { at: image.timestamp, order: order += 1, bytes, ...size };
      const late = saved.get(sender);
      if (!open.has(sender) && late && page.at >= late.lastAt && page.at - late.lastAt <= LATE_PAGE_MS) {
        late.pages.push(page); late.lastAt = page.at;
        save(late);
        return;
      }
      const post = open.get(sender);
      if (post && Math.abs(page.at - post.lastAt) > PAGE_GAP_MS) close(sender);
      const current = open.get(sender) ?? { pages: [], lastAt: page.at };
      open.set(sender, current);
      current.pages.push(page);
      current.lastAt = Math.max(current.lastAt, page.at);
      if (current.timer) clearTimeout(current.timer);
      current.timer = schedule(() => close(sender), PAGE_GAP_MS);
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
