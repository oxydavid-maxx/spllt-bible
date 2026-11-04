// scripts/check-contrast.ts — 夜間模式 (光佑 2026-11-04): every pair of words and ground the screens use reads at
// 4.5:1 or more (WCAG 2.2 1.4.3), and every control's edge stands out from what is around it at 3:1 or more (1.4.11),
// in the light palette and the dark one (src/ui/Theme.ts).
// usage: tsx scripts/check-contrast.ts [--palette <json with tokens to override in both palettes>]
// Exit 1 when any pair falls short. tests/ui/themeContrast.test.ts runs it, including a palette that must fail.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkColors, lightColors, type AppColors } from '../src/ui/Theme';

type Token = keyof AppColors;
export interface PairCheck { kind: 'text' | 'control'; fg: Token; bg: Token; ratio: number; min: number; ok: boolean }

// Words: what the screens put on each ground. Grounds a word never sits on are left out.
const TEXT: Array<[Token[], Token[]]> = [
  [['ink', 'muted', 'primary', 'primaryDeep', 'danger', 'accent', 'goldText'], ['background', 'surface']],
  [['ink', 'muted', 'primary', 'danger'], ['surfaceMuted']],
  [['ink', 'muted', 'primary', 'scriptureInk', 'scriptureMuted'], ['readerSurface']],
  [['ink', 'primary', 'primaryDeep'], ['primarySoft']],
  [['accent'], ['accentSoft']],
  [['warning'], ['warningSoft']],
  [['onFill'], ['primaryFill', 'primaryDeepFill', 'accentFill', 'dangerFill', 'mediaStage']],
  [['onFillSoft'], ['primaryFill']],
  // The 團體 calendar's day numbers and counts on its four shades.
  [['ink', 'muted'], ['primarySoft']],
  [['ink'], ['heatHigh']],
  // The reading calendar's 靈修 mark, on an open day and on a read (filled) day.
  [['goldText', 'accent'], ['surfaceMuted']],
  [['goldOnPrimary'], ['primaryFill']],
  [['primaryDeepFill'], ['onFill']],
  [['onInverse'], ['inverse']],
  [['muted'], ['imagePlaceholder']],
  [['onViewer'], ['viewerStage']],
  [['onMediaSoft'], ['mediaStage']],
  [['scriptureInk'], ['readAlong']],
];
// Edges of controls: outlined buttons and inputs, and filled buttons against the page around them.
const CONTROL: Array<[Token[], Token[]]> = [
  [['borderStrong', 'primary'], ['background', 'surface', 'readerSurface']],
  [['primaryFill'], ['background', 'surface', 'readerSurface']],
];

function rgb(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return null;
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(fg: string, bg: string): number {
  const a = rgb(fg), b = rgb(bg);
  if (!a || !b) return Number.NaN;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function checkPalette(colors: AppColors): PairCheck[] {
  const rows: PairCheck[] = [];
  const add = (kind: PairCheck['kind'], groups: Array<[Token[], Token[]]>, min: number) => {
    for (const [fgs, bgs] of groups) for (const fg of fgs) for (const bg of bgs) {
      const ratio = contrast(colors[fg], colors[bg]);
      // A colour that cannot be read is a failure, never a pass (NaN >= min is false).
      rows.push({ kind, fg, bg, ratio, min, ok: ratio >= min });
    }
  };
  add('text', TEXT, 4.5);
  add('control', CONTROL, 3);
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--palette');
  const override = at > 0 ? JSON.parse(readFileSync(process.argv[at + 1], 'utf8')) as Partial<AppColors> : {};
  let failed = 0;
  for (const [name, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
    const rows = checkPalette({ ...palette, ...override });
    const bad = rows.filter((row) => !row.ok);
    failed += bad.length;
    console.log(`${name}: ${rows.length - bad.length}/${rows.length} pairs pass`);
    for (const row of bad) console.log(`  FAIL ${row.kind} ${row.fg} ${palette[row.fg] && (override[row.fg] ?? palette[row.fg])} on ${row.bg} ${override[row.bg] ?? palette[row.bg]}: ${row.ratio.toFixed(2)}:1 < ${row.min}:1`);
    const lowest = [...rows].sort((a, b) => a.ratio / a.min - b.ratio / b.min).slice(0, 3);
    console.log(`  closest: ${lowest.map((row) => `${row.fg}/${row.bg} ${row.ratio.toFixed(2)}:1 (min ${row.min})`).join(', ')}`);
  }
  console.log(failed === 0 ? 'CONTRAST PASS' : `CONTRAST FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}
