// scripts/ios/check-bulletin-viewer.ts — CI only, run by scripts/ios/run-flows.sh right after flow 44-bulletin, which
// ends with a 週刊 page open full screen. The screenshot shows whether the viewer's black bar sits under the status bar
// or covers it: 0.5.35 drew the bar from the top edge, and with the app's dark status bar icons on black the clock and
// battery disappeared (Pixel, 2026-10-20). The status bar area must stay light (the app background) and the black
// viewer must start just under it. Rows are read by their median, so the clock's dark marks do not count.
// usage: tsx scripts/ios/check-bulletin-viewer.ts <screenshot.png> [<receipt.json>]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJimp } from '../../server/bulletinsImage';

export interface Bitmap { width: number; height: number; data: Uint8Array }
export interface ViewerTopCheck { ok: boolean; problems: string[]; height: number; statusRows: number; firstDarkRow: number | null }

const LIGHT = 170;
const DARK = 60;
// Every phone's status bar is taller than 2% of the screen (iPhone 17: 186 of 2622 px), and the viewer starts within
// the top 15% (status bar plus nothing else).
const STATUS_SHARE = 0.02;
const VIEWER_SHARE = 0.15;

function rowLuminance(bitmap: Bitmap, y: number): number {
  const step = Math.max(1, Math.floor(bitmap.width / 200));
  const values: number[] = [];
  for (let x = 0; x < bitmap.width; x += step) {
    const at = (y * bitmap.width + x) * 4;
    values.push(0.2126 * bitmap.data[at] + 0.7152 * bitmap.data[at + 1] + 0.0722 * bitmap.data[at + 2]);
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

export function checkViewerTop(bitmap: Bitmap): ViewerTopCheck {
  const statusRows = Math.ceil(bitmap.height * STATUS_SHARE);
  const problems: string[] = [];
  let covered = false;
  for (let y = 0; y < statusRows; y += 1) if (rowLuminance(bitmap, y) < LIGHT) { covered = true; break; }
  let firstDarkRow: number | null = null;
  for (let y = 0; y < Math.floor(bitmap.height * VIEWER_SHARE); y += 1) if (rowLuminance(bitmap, y) <= DARK) { firstDarkRow = y; break; }
  if (covered) problems.push('the status bar area is dark: the viewer bar covers it');
  else if (firstDarkRow === null) problems.push('no dark viewer near the top: the page was not open');
  return { ok: problems.length === 0, problems, height: bitmap.height, statusRows, firstDarkRow };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [shot, receipt] = process.argv.slice(2);
  void (async () => {
    let result: ViewerTopCheck;
    try {
      const image = await loadJimp().read(readFileSync(shot));
      result = checkViewerTop(image.bitmap);
    } catch (error) {
      result = { ok: false, problems: [`no screenshot to read (${shot || 'none'}): ${(error as Error).message}`], height: 0, statusRows: 0, firstDarkRow: null };
    }
    if (receipt) writeFileSync(receipt, JSON.stringify(result, null, 2));
    console.log(`height=${result.height} statusRows=${result.statusRows} firstDarkRow=${result.firstDarkRow ?? '-'}`);
    console.log(result.ok ? 'BULLETIN_VIEWER_TOP PASS' : `BULLETIN_VIEWER_TOP FAIL\n${result.problems.join('\n')}`);
    process.exit(result.ok ? 0 : 1);
  })();
}
