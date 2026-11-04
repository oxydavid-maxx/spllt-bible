// scripts/ios/check-dark-screens.ts — CI only, run by scripts/ios/run-flows.sh right after .maestro/ios/45-night-mode.yaml,
// which screenshots every screen of the approved 夜間模式 mock with the app set to 一直深色 (光佑 2026-11-04).
// A screen that missed the dark palette shows up as a white block: a white card, sheet, chip or page. White words on
// the dark page are thin strokes, so a block is an area at least BLOCK_PT × BLOCK_PT points where every pixel is
// white; a screen fails when such white blocks join into one region bigger than MAX_REGION of the screen.
// The status bar is the system's (its battery is drawn white at night) and is left out. Allowed by decision: the friend
// QR stays black on white (the white inside its square on the QR screen); on the sign-in screen Apple's button is white at
// night (one wide button-shaped region) and the app icon picture stays as it is (one square region above the title), as
// in the mock; the 新功能 card's small 白底 sample screen is white on purpose. The 週刊 pages are dimmed to 0.82, under
// the white threshold.
// usage: tsx scripts/ios/check-dark-screens.ts <dir with night-*.png | a .png> [<receipt.json>]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJimp } from '../../server/bulletinsImage';

export interface Bitmap { width: number; height: number; data: Uint8Array }
export interface Region { x: number; y: number; width: number; height: number; share: number }
export interface DarkScreenCheck { name: string; ok: boolean; whiteShare: number; regions: Region[]; allowed: Region[]; problems: string[] }

const WHITE = 230;
const POINTS_WIDE = 402; // iPhone 17 in points; screenshots are 3× (1206 px)
const BLOCK_PT = 10;
const STATUS_PT = 60;
const MAX_REGION = 0.004;

export function checkDarkScreen(name: string, bitmap: Bitmap): DarkScreenCheck {
  const { width, height, data } = bitmap;
  const scale = width / POINTS_WIDE;
  const block = Math.max(2, Math.round(BLOCK_PT * scale));
  const top = Math.round(STATUS_PT * scale);
  // Integral image of white pixels (below the status bar).
  const W = width + 1;
  const sum = new Uint32Array(W * (height + 1));
  let whiteCount = 0;
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const white = y >= top && data[at] >= WHITE && data[at + 1] >= WHITE && data[at + 2] >= WHITE ? 1 : 0;
      whiteCount += white;
      row += white;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const area = block * block;
  // Pixels covered by at least one all-white block, on a grid of `step` px.
  const step = Math.max(1, Math.round(scale));
  const gw = Math.ceil(width / step), gh = Math.ceil(height / step);
  const covered = new Uint8Array(gw * gh);
  for (let y = top; y + block <= height; y += step) {
    for (let x = 0; x + block <= width; x += step) {
      const s = sum[(y + block) * W + x + block] - sum[y * W + x + block] - sum[(y + block) * W + x] + sum[y * W + x];
      if (s !== area) continue;
      for (let gy = Math.floor(y / step); gy < Math.min(gh, Math.ceil((y + block) / step)); gy += 1) {
        covered.fill(1, gy * gw + Math.floor(x / step), gy * gw + Math.min(gw, Math.ceil((x + block) / step)));
      }
    }
  }
  // Connected regions of covered grid cells.
  const regions: Region[] = [];
  const seen = new Uint8Array(gw * gh);
  const queue = new Int32Array(gw * gh);
  for (let start = 0; start < covered.length; start += 1) {
    if (!covered[start] || seen[start]) continue;
    let head = 0, tail = 0, count = 0;
    let minX = gw, minY = gh, maxX = 0, maxY = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const cell = queue[head++];
      count += 1;
      const cx = cell % gw, cy = (cell - cx) / gw;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (const next of [cell - 1, cell + 1, cell - gw, cell + gw]) {
        if (next < 0 || next >= covered.length || seen[next] || !covered[next]) continue;
        if ((next === cell - 1 && cx === 0) || (next === cell + 1 && cx === gw - 1)) continue;
        seen[next] = 1; queue[tail++] = next;
      }
    }
    regions.push({ x: minX * step, y: minY * step, width: (maxX - minX + 1) * step, height: (maxY - minY + 1) * step, share: count / (gw * gh) });
  }
  regions.sort((a, b) => b.share - a.share);
  const big = regions.filter((region) => region.share > MAX_REGION);
  const allowed: Region[] = [];
  const aspect = (region: Region) => region.width / region.height;
  const squarish = (region: Region) => aspect(region) > 0.8 && aspect(region) < 1.25;
  if (/friend-qr/.test(name)) {
    // The QR's white (quiet zone and the gaps between its marks) can split into several regions; all of them sit
    // inside the square of the largest one.
    const qr = big.find(squarish);
    if (qr) {
      const pad = 6 * scale;
      const inside = (region: Region) => region.x >= qr.x - pad && region.y >= qr.y - pad && region.x + region.width <= qr.x + qr.width + pad && region.y + region.height <= qr.y + qr.height + pad;
      allowed.push(...big.filter(inside));
    }
  }
  if (/sign-in/.test(name)) {
    // Apple's white button, and the app icon picture above the title (the approved mock keeps both).
    const button = big.find((region) => aspect(region) > 4 && region.height <= 70 * scale);
    if (button) allowed.push(button);
    const icon = big.find((region) => squarish(region) && region.width >= 60 * scale && region.width <= 140 * scale && region.y < height / 2);
    if (icon) allowed.push(icon);
  }
  if (/whats-new/.test(name)) {
    // The 新功能 card draws a small white sample screen for 06:00–18:00 白底 (left of the dark one), on purpose.
    allowed.push(...big.filter((region) => region.x + region.width <= width / 2 && region.width <= 200 * scale && region.height <= 80 * scale));
  }
  const failing = big.filter((region) => !allowed.includes(region));
  const problems = failing.map((region) => `white block ${Math.round(region.width / scale)}×${Math.round(region.height / scale)} pt at (${Math.round(region.x / scale)}, ${Math.round(region.y / scale)}) pt, ${(region.share * 100).toFixed(2)}% of the screen`);
  return { name, ok: problems.length === 0, whiteShare: whiteCount / (width * height), regions: big, allowed, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, receipt] = process.argv.slice(2);
  void (async () => {
    const files = target && statSync(target, { throwIfNoEntry: false })?.isDirectory()
      ? readdirSync(target).filter((name) => /^night-.*\.png$/.test(name) && !/native-screen/.test(name)).sort().map((name) => join(target, name))
      : target ? [target] : [];
    const results: DarkScreenCheck[] = [];
    for (const file of files) {
      try {
        const image = await loadJimp().read(readFileSync(file));
        results.push(checkDarkScreen(basename(file), image.bitmap));
      } catch (error) {
        results.push({ name: basename(file), ok: false, whiteShare: Number.NaN, regions: [], allowed: [], problems: [`could not read: ${(error as Error).message}`] });
      }
    }
    // A run with no screenshots proves nothing: that is a failure, not a pass.
    const ok = results.length > 0 && results.every((result) => result.ok);
    if (receipt) writeFileSync(receipt, JSON.stringify({ ok, results }, null, 2));
    for (const result of results) {
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name} white=${(result.whiteShare * 100).toFixed(2)}%${result.allowed.length ? ` allowed=${result.allowed.length}` : ''}`);
      for (const problem of result.problems) console.log(`  ${problem}`);
    }
    console.log(ok ? `DARK_SCREENS PASS (${results.length})` : `DARK_SCREENS FAIL${results.length ? '' : ' (no night-*.png screenshots)'}`);
    process.exit(ok ? 0 : 1);
  })();
}
