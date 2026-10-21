// scripts/ios/make-bulletin-fixture.ts — the synthetic 週刊 the CI fixture backend serves for flow 44-bulletin.
// Made for each run instead of kept in the repo: the 10/18 週刊 came in at 2481 × 3509 (A4 at 300 dpi), and two
// pictures that size are a few megabytes of binary in a public repo. The pages are drawn, not photographed: a header
// band, two columns of glyph-like marks, a table and a soft photo block, so they compress about like a printed
// bulletin and the phone copy (server/bulletinsResize.ts) has real work to do. Nothing here is a real bulletin.
// The phone copies are made here too, with the backend's own code, before the simulator starts: on the CI Mac one copy
// took 31 s while the simulator ran, longer than a request waits for it. The receipt records each page's size and its
// copies' sizes (the KB a phone downloads per page, before and after).
// usage: tsx scripts/ios/make-bulletin-fixture.ts <bulletin-dir> [<receipt.json>]
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BulletinWeek } from '../../server/bulletins';
import { loadJimp } from '../../server/bulletinsImage';
import { createBulletinPhoneCopies } from '../../server/bulletinsResize';
import { BULLETIN_LIST_WIDTHS } from '../../src/domain/bulletinWidths';

export const FIXTURE_WEEK = { date: '2026-08-30', postedAt: '2026-08-29T22:00:00.000Z' } as const;
export const FIXTURE_PAGE = { width: 2481, height: 3509 } as const;

/** One synthetic A4 page as a JPEG; the same seed always draws the same page. */
export async function syntheticBulletinPage(size: { width: number; height: number }, seed: number): Promise<Uint8Array> {
  const Jimp = loadJimp();
  const { width, height } = size;
  const page = new Jimp(width, height, 0xffffffff);
  const data = page.bitmap.data;
  let state = seed * 2654435761 >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x1_0000_0000; };
  const unit = width / 2481;
  const fill = (x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(height, Math.round(y0 + h)); y += 1) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(width, Math.round(x0 + w)); x += 1) data.set(rgb, (y * width + x) * 4);
    }
  };
  // A glyph: a few strokes in a square cell, about the density of a printed Chinese character.
  const glyph = (x: number, y: number, cell: number, rgb: [number, number, number]) => {
    const stroke = Math.max(2, Math.round(cell / 11));
    for (let n = 3 + Math.floor(random() * 4); n > 0; n -= 1) {
      const across = random() < 0.55;
      const at = random() * (cell - stroke);
      const from = random() * cell * 0.4;
      const length = cell * (0.4 + random() * 0.6) - from;
      if (across) fill(x + from, y + at, length, stroke, rgb); else fill(x + at, y + from, stroke, length, rgb);
    }
  };
  const ink: [number, number, number] = [28, 28, 28];
  const margin = 150 * unit;
  // Header band with the title in white.
  fill(0, 0, width, 300 * unit, [26, 85, 68]);
  for (let x = margin; x < width * 0.6; x += 92 * unit) glyph(x, 90 * unit, 80 * unit, [255, 255, 255]);
  // Two columns of text.
  const cell = 38 * unit;
  const column = (width - margin * 3) / 2;
  for (const left of [margin, margin * 2 + column]) {
    for (let y = 400 * unit; y < height * 0.62; y += cell * 1.55) {
      const end = left + column * (random() < 0.15 ? 0.5 + random() * 0.4 : 1);
      for (let x = left; x + cell <= end; x += cell * 1.08) glyph(x, y, cell, ink);
    }
  }
  // A table: ruled cells with a few glyphs each.
  const top = height * 0.65;
  const rows = 6;
  const cols = 4;
  const tableWidth = width - margin * 2;
  const rowHeight = 110 * unit;
  for (let r = 0; r <= rows; r += 1) fill(margin, top + r * rowHeight, tableWidth, 4 * unit, ink);
  for (let c = 0; c <= cols; c += 1) fill(margin + (c * tableWidth) / cols, top, 4 * unit, rows * rowHeight, ink);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      for (let g = 0, n = 2 + Math.floor(random() * 6); g < n; g += 1) glyph(margin + (c * tableWidth) / cols + 30 * unit + g * cell * 1.08, top + r * rowHeight + 36 * unit, cell, ink);
    }
  }
  // A soft photo block: smooth light with a little grain.
  const photo = { x: margin, y: top + rows * rowHeight + 80 * unit, w: width * 0.42, h: height - (top + rows * rowHeight + 80 * unit) - margin };
  for (let y = 0; y < photo.h; y += 1) {
    for (let x = 0; x < photo.w; x += 1) {
      const light = 120 + 80 * Math.sin(x / (photo.w / 3) + seed) * Math.cos(y / (photo.h / 2)) + random() * 18;
      const at = ((Math.round(photo.y) + y) * width + Math.round(photo.x) + x) * 4;
      data.set([Math.min(255, light * 0.9), Math.min(255, light), Math.min(255, light * 0.8)], at);
    }
  }
  for (let y = photo.y; y < photo.y + photo.h; y += cell * 1.55) {
    for (let x = photo.x + photo.w + margin / 2; x + cell <= width - margin; x += cell * 1.08) glyph(x, y, cell, ink);
  }
  return Uint8Array.from(await page.quality(90).getBufferAsync(Jimp.MIME_JPEG));
}

/** Writes the fixture 週刊 (meta.json and the pages) under <dir>/<date>/, the layout server/bulletins.ts keeps. */
export async function writeFixtureBulletin(dir: string, size: { width: number; height: number } = FIXTURE_PAGE, pages = 2): Promise<BulletinWeek> {
  const folder = join(dir, FIXTURE_WEEK.date);
  mkdirSync(folder, { recursive: true });
  const week: BulletinWeek = { ...FIXTURE_WEEK, pages: [] };
  for (let index = 1; index <= pages; index += 1) {
    writeFileSync(join(folder, `${index}.jpg`), await syntheticBulletinPage(size, index));
    week.pages.push({ index, width: size.width, height: size.height });
  }
  writeFileSync(join(folder, 'meta.json'), JSON.stringify(week));
  return week;
}

export interface FixtureCopies { date: string; pages: Array<{ index: number; bytes: number; copies: Record<string, number | null> }> }

/** Makes every phone copy of the fixture 週刊 the way the backend does, and reports the sizes (null: not made). */
export async function makeFixtureCopies(dir: string, week: BulletinWeek): Promise<FixtureCopies> {
  const copies = createBulletinPhoneCopies(dir, { log: () => undefined });
  const pages: FixtureCopies['pages'] = [];
  for (const page of week.pages) {
    const made: Record<string, number | null> = {};
    for (const width of BULLETIN_LIST_WIDTHS) made[width] = (await copies.copy(week.date, page.index, width))?.length ?? null;
    pages.push({ index: page.index, bytes: statSync(join(dir, week.date, `${page.index}.jpg`)).size, copies: made });
  }
  return { date: week.date, pages };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, receipt] = process.argv.slice(2);
  if (!dir) { console.error('usage: tsx scripts/ios/make-bulletin-fixture.ts <bulletin-dir> [<receipt.json>]'); process.exit(2); }
  void (async () => {
    const week = await writeFixtureBulletin(dir);
    const made = await makeFixtureCopies(dir, week);
    if (receipt) writeFileSync(receipt, JSON.stringify(made, null, 2));
    const kb = (bytes: number | null) => (bytes === null ? 'none' : `${(bytes / 1024).toFixed(1)}KB`);
    for (const page of made.pages) console.log(`fixture 週刊 ${made.date} page ${page.index}: original ${kb(page.bytes)}, ${Object.entries(page.copies).map(([width, bytes]) => `w${width} ${kb(bytes)}`).join(', ')}`);
    if (made.pages.some((page) => Object.values(page.copies).includes(null))) { console.error('phone copies could not be made (server/bulletinsResize.ts)'); process.exit(1); }
  })().catch((error) => { console.error(error); process.exit(1); });
}
