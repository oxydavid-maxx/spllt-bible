// scripts/ota/verify-ota-bundle.ts — the gate every EAS Update passes before it is pushed (docs/eas-update.md).
// usage: tsx scripts/ota/verify-ota-bundle.ts <export-dir> [--platform android|ios]... [--plan data/reading-plan-2026.json]
//
// 2026-10-20: `expo export` (@expo/cli 56.1.25) renamed the 'use dom' html files inside already-compiled Hermes
// bytecode. hermesc packs strings that share bytes into one buffer, so the rename also overwrote neighbours:
// "2026-10-06" shipped as "2026-10-07…" and the first preview OTA crashed on launch (expo/expo#49626).
// Checks, per platform in metadata.json:
//   1. the launch bundle is Hermes bytecode whose footer SHA-1 (written by hermesc over the whole file) still
//      matches: anything that edits the file after hermesc, like that rename, breaks it;
//   2. every reading-plan date, reference and source row is in the bytecode (the strings that broke);
//   3. every DOM component html the bytecode names was exported under that name, named after its own md5
//      (expo-updates stores assets by content hash; the WebView finds the html only under that name).
// Exit 1 on any FAIL: do not push. Node-only: no react-native imports (tests/tools/releaseScriptsLoad.test.ts).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type OtaPlatform = 'android' | 'ios';
export interface GateCheck { platform: string; name: string; ok: boolean; detail: string }

const HERMES_MAGIC = 0x1f1903c103bc1fc6n;
const SHA1_BYTES = 20;
const HEADER_BYTES = 128;
const HTML_NAME = /[0-9a-f]{32}\.html/g;

export interface HermesBytecodeInfo { hermes: boolean; version: number | null; lengthOk: boolean; recordedSha1: string | null; actualSha1: string | null; intact: boolean }

/** Header and footer of a Hermes bytecode file. hermesc ends the file with the SHA-1 of everything before it. */
export function inspectHermesBytecode(bytes: Buffer): HermesBytecodeInfo {
  if (bytes.length < HEADER_BYTES + SHA1_BYTES || bytes.readBigUInt64LE(0) !== HERMES_MAGIC) {
    return { hermes: false, version: null, lengthOk: false, recordedSha1: null, actualSha1: null, intact: false };
  }
  const recordedSha1 = bytes.subarray(bytes.length - SHA1_BYTES).toString('hex');
  const actualSha1 = createHash('sha1').update(bytes.subarray(0, bytes.length - SHA1_BYTES)).digest('hex');
  const lengthOk = bytes.readUInt32LE(32) === bytes.length;
  return { hermes: true, version: bytes.readUInt32LE(8), lengthOk, recordedSha1, actualSha1, intact: lengthOk && recordedSha1 === actualSha1 };
}

/** Hermes keeps ASCII strings as one byte per character and everything else as UTF-16LE. */
export function hermesStringBytes(value: string): Buffer {
  return /^[\x00-\x7f]*$/.test(value) ? Buffer.from(value, 'latin1') : Buffer.from(value, 'utf16le');
}

export interface PlanStrings { dates: string[]; references: string[]; sourceRows: string[] }

export function readingPlanStrings(plan: unknown): PlanStrings {
  const days = (plan as { days?: Array<{ date?: unknown; references?: unknown; source_rows?: unknown }> } | null)?.days;
  if (!Array.isArray(days) || days.length === 0) throw new Error('讀經計畫沒有 days');
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  return {
    dates: days.map((day) => String(day.date)),
    references: [...new Set(days.flatMap((day) => strings(day.references)))],
    sourceRows: [...new Set(days.flatMap((day) => strings(day.source_rows)))],
  };
}

/**
 * Why a string is missing, when the bytecode shows it: its head followed straight by a DOM html name means hermesc
 * packed the string against that name and the post-compile rename overwrote the shared tail.
 */
export function missingStringEvidence(bytes: Buffer, value: string): string {
  const latin = bytes.toString('latin1');
  for (let shared = 1; shared < value.length && shared <= 32; shared += 1) {
    const head = value.slice(0, value.length - shared);
    for (let at = latin.indexOf(head); at !== -1; at = latin.indexOf(head, at + 1)) {
      const name = /^[0-9a-f]{32}\.html/.exec(latin.slice(at + head.length, at + head.length + 37))?.[0];
      if (name) return `「${value}」找不到；bytecode 裡「${head}」直接接著網頁元件檔名 ${name}，讀起來是「${head}${name.slice(0, shared)}」`;
    }
  }
  return `「${value}」找不到`;
}

function missingStrings(bytes: Buffer, values: string[]): string[] {
  return values.filter((value) => bytes.indexOf(hermesStringBytes(value)) === -1);
}

interface Metadata { fileMetadata?: Record<string, { bundle?: string; assets?: Array<{ path?: string; ext?: string }> }> }

export function verifyOtaExport(exportDir: string, options: { platforms?: OtaPlatform[]; plan: unknown }): GateCheck[] {
  const checks: GateCheck[] = [];
  const add = (platform: string, name: string, ok: boolean, detail: string) => { checks.push({ platform, name, ok, detail }); };
  let metadata: Metadata | null = null;
  try { metadata = JSON.parse(readFileSync(join(exportDir, 'metadata.json'), 'utf8')) as Metadata; } catch { metadata = null; }
  const exported = Object.keys(metadata?.fileMetadata ?? {});
  const platforms = options.platforms?.length ? options.platforms : exported;
  if (!metadata || platforms.length === 0) {
    add('-', 'metadata.json', false, `${join(exportDir, 'metadata.json')} 讀不到或沒有平台；先 expo export`);
    return checks;
  }
  const plan = readingPlanStrings(options.plan);
  for (const platform of platforms) {
    const entry = metadata.fileMetadata?.[platform];
    const bundlePath = entry?.bundle ? join(exportDir, entry.bundle) : null;
    if (!entry || !bundlePath || !existsSync(bundlePath)) {
      add(platform, 'bundle', false, `metadata.json 沒有 ${platform} 的 bundle，或檔案不存在；export 時要帶 --platform ${platform}`);
      continue;
    }
    const bytes = readFileSync(bundlePath);
    const info = inspectHermesBytecode(bytes);
    if (!info.hermes) {
      add(platform, 'Hermes bytecode', false, `${entry.bundle} 不是 Hermes bytecode；不可用 --no-bytecode 發送`);
      continue;
    }
    add(platform, 'bytecode 未被改寫', info.intact, info.intact
      ? `${basename(bundlePath)}，Hermes v${info.version}，檔尾 SHA-1 ${info.actualSha1?.slice(0, 12)} 相符`
      : `${basename(bundlePath)} 在 hermesc 編完之後被改寫過：檔尾記錄 SHA-1 ${info.recordedSha1?.slice(0, 12)}，實際 ${info.actualSha1?.slice(0, 12)}${info.lengthOk ? '' : '，檔頭長度也不符'}`);

    const missingDates = missingStrings(bytes, plan.dates);
    add(platform, `讀經計畫 ${plan.dates.length} 個日期`, missingDates.length === 0, missingDates.length === 0
      ? `${plan.dates.length} 個都在 bytecode 裡`
      : `缺 ${missingDates.length} 個：${missingDates.map((value) => missingStringEvidence(bytes, value)).join('；')}`);
    const otherPlanStrings = [...plan.references, ...plan.sourceRows];
    const missingOthers = missingStrings(bytes, otherPlanStrings);
    add(platform, `讀經計畫 ${otherPlanStrings.length} 個章節字串`, missingOthers.length === 0, missingOthers.length === 0
      ? `經文代號 ${plan.references.length} 個、原文 ${plan.sourceRows.length} 個都在`
      : `缺 ${missingOthers.length} 個：${missingOthers.slice(0, 10).map((value) => missingStringEvidence(bytes, value)).join('；')}`);

    const htmlAssets = (entry.assets ?? []).filter((asset) => asset.ext === 'html' && asset.path);
    const assetNames = new Map(htmlAssets.map((asset) => [basename(String(asset.path)), String(asset.path)]));
    const referenced = new Set(bytes.toString('latin1').match(HTML_NAME) ?? []);
    const problems: string[] = [];
    for (const name of referenced) if (!assetNames.has(name)) problems.push(`bytecode 指向 ${name}，但這次沒有匯出這個檔`);
    for (const [name, path] of assetNames) {
      const file = join(exportDir, path);
      if (!existsSync(file)) { problems.push(`${path} 不存在`); continue; }
      const md5 = createHash('md5').update(readFileSync(file)).digest('hex');
      if (`${md5}.html` !== name) problems.push(`${path} 的內容 md5 是 ${md5}，檔名不符`);
      if (!referenced.has(name)) problems.push(`${name} 沒有被 bytecode 參照`);
    }
    add(platform, '網頁元件 html', problems.length === 0, problems.length === 0
      ? `${assetNames.size} 個 html 的檔名＝內容 md5，跟 bytecode 的參照一致`
      : problems.join('；'));
  }
  return checks;
}

export function formatGateTable(checks: GateCheck[]): string {
  const lines = ['| 平台 | 檢查 | 結果 | 說明 |', '|---|---|---|---|'];
  for (const check of checks) lines.push(`| ${check.platform} | ${check.name} | ${check.ok ? 'PASS' : 'FAIL'} | ${check.detail.replace(/\|/g, '\\|')} |`);
  const failed = checks.filter((check) => !check.ok).length;
  lines.push('', failed === 0 ? 'OTA 匯出檢查 PASS：可以推。' : `OTA 匯出檢查 FAIL (${failed} 項)：不要推這份匯出。`);
  return lines.join('\n');
}

export const DEFAULT_PLAN = 'data/reading-plan-2026.json';

function main(argv: string[]): number {
  const platforms: OtaPlatform[] = [];
  let plan = DEFAULT_PLAN;
  let dir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') {
      const value = argv[++index];
      if (value !== 'android' && value !== 'ios') { dir = undefined; break; }
      platforms.push(value);
    } else if (arg === '--plan') plan = argv[++index] ?? plan;
    else if (!dir) dir = arg;
  }
  if (!dir) {
    console.error('usage: tsx scripts/ota/verify-ota-bundle.ts <export-dir> [--platform android|ios]... [--plan data/reading-plan-2026.json]');
    return 2;
  }
  const checks = verifyOtaExport(resolve(dir), { platforms, plan: JSON.parse(readFileSync(resolve(plan), 'utf8')) });
  console.log(formatGateTable(checks));
  return checks.every((check) => check.ok) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
