// scripts/ios/ota-verify.ts — iPhone OTA acceptance on the iOS simulator (.github/workflows/ios-ota-verify.yml).
// The App Store build's native layer is rebuilt for the simulator, the app's own startup check downloads the
// update from the real EAS Update service, and a second cold start must run exactly the update the group names.
// Subcommands (each writes JSON under <out>; only `verdict` decides PASS/FAIL):
//   resolve <group-id> <channel> <out>   which iOS update the group holds (public endpoints, no token) and which
//                                        store build (scripts/ios/store-builds.json) it has to run on
//   native  <app-path> <out>             give the simulator app the store build's embedded update time, re-sign,
//                                        read back Info.plist/Expo.plist/app.config for the native checks
//   wait-download <udid> <out> <seconds> after cold start 1: wait until expo-updates holds a ready update
//   api-host <udid> <out> <host>         the downloaded update's JS names the API host the run redirects
//   api-proxy <port> <target> <log> <cert> <key>  HTTPS on 127.0.0.1 and ::1 for that host, to the fixture backend
//   db <udid> <file>                     expo-updates' own record of stored updates and launch counts
//   collect <udid> <out> <since>         after cold start 2: process, crash reports, JS fatals, expo-updates log
//   verdict <out>                        every check PASS/FAIL with its evidence; exit 1 unless all PASS
// Never publishes, republishes or changes a channel: it only reads what the app itself would read.
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalReadingPlan, getInitialReadingDate, getReadingDay } from '../../src/domain/calendar';
import { formatReferenceListZhTw } from '../../src/domain/scriptureReference';
import { redactEvidence } from './sanitize-evidence';

export const BUNDLE_ID = 'org.qingmu.youth';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ['preview', 'production'] as const;
type Channel = typeof CHANNELS[number];
const STATUS_READY = 1; // expo-updates ios/EXUpdates/Update/Update.swift UpdateStatus.StatusReady
const STATUS_EMBEDDED = 5;

export interface UpdateManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  metadata?: { updateGroup?: string; branchName?: string };
  extra?: { expoClient?: Record<string, unknown> };
}
export interface ManifestFetch { url: string; status: number | null; updateId: string | null; error: string | null }
export interface StoreBuild { runtime: string; version: string; buildNumber: string; commit: string; easBuildId?: string; completedAt: string }
export interface ResolveRecord {
  groupId: string;
  channel: Channel;
  projectId: string;
  group: ManifestFetch & { updateGroup: string | null; branchName: string | null; createdAt: string | null; runtimeVersion: string | null };
  channelNow: ManifestFetch & { updateGroup: string | null };
  store: StoreBuild | null;
  expected: { updateId: string; createdAt: string; runtimeVersion: string; label: string } | null;
  resolvedAt: string;
}
export interface DbRow { id: string; commitTime: number; status: number; successfulLaunches: number; failedLaunches: number }
export interface DbRecord { measured: boolean; rows: DbRow[]; error: string | null }
export interface NativeRecord {
  sourceCommit: string | null;
  bundleId: string | null; version: string | null; buildNumber: string | null; urlSchemes: string[];
  updates: { enabled: unknown; url: unknown; runtimeVersion: unknown; channel: unknown; checkOnLaunch: unknown; launchWaitMs: unknown; hasEmbeddedUpdate: unknown };
  embedded: { originalCommitTime: number | null; commitTime: number | null; targetCommitTime: number | null };
  signature: { valid: boolean; entitlementsUnchanged: boolean; detail: string };
  configDifferences: string[] | null;
}
export interface EndState {
  appRunning: boolean | null;
  crashReports: string[] | null;
  jsFatalLines: string[] | null;
  updatesLogLines: number | null;
  errorRecoveryLines: string[] | null;
  expoErrorLog: boolean | null;
  simulatorClock: string | null;
}
export interface Isolation {
  /** The downloaded update's files that contain https://<host> (its API base is the host the run redirects). */
  apiHost: { host: string; filesWithHost: number; filesScanned: number } | null;
  /** curl to https://<host>/api/health trusting only the run's throwaway CA: answered by the local fixture. */
  redirectAnswered: boolean | null;
  /** Requests the API-host listener forwarded to the fixture backend during cold start 2. */
  apiRequests: number | null;
}
export interface Evidence {
  resolve: ResolveRecord | null;
  native: NativeRecord | null;
  isolation: Isolation | null;
  download: { waitedSeconds: number; readyIds: string[] } | null;
  launch1: DbRecord | null;
  launch2: DbRecord | null;
  flows: Record<string, string>;
  readerTexts: string[] | null;
  accountTexts: string[] | null;
  end: EndState | null;
  today: string;
}
export interface Check { id: string; name: string; status: 'PASS' | 'FAIL'; detail: string }
export interface Verdict { verdict: 'PASS' | 'FAIL'; groupId: string | null; expectedUpdateId: string | null; observedUpdateIds: string[]; checks: Check[] }

/** EAS answers multipart/mixed with a `manifest` part (expo-updates protocol 1); plain JSON is accepted too. */
export function parseManifestResponse(contentType: string | null, body: string): UpdateManifest | null {
  const type = (contentType ?? '').toLowerCase();
  let json: string | null = null;
  if (type.startsWith('multipart/')) {
    const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
    const marker = boundary?.[1] ?? boundary?.[2];
    if (!marker) return null;
    for (const part of body.split(`--${marker}`)) {
      const split = /\r?\n\r?\n/.exec(part);
      if (!split) continue;
      if (!/name="manifest"/i.test(part.slice(0, split.index))) continue;
      json = part.slice(split.index + split[0].length).trim();
      break;
    }
  } else if (type.includes('json')) json = body;
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<UpdateManifest>;
    if (typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.createdAt !== 'string' || typeof value.runtimeVersion !== 'string') return null;
    return value as UpdateManifest;
  } catch {
    return null;
  }
}

function taipeiDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(iso)).replace(/-/g, '');
}
export function taipeiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now);
}
/** What the account page's version line adds for a downloaded update (src/ui/accountSurface.ts), on a phone in Taiwan. */
export function updateLabelSuffix(updateId: string, createdAt: string): string {
  return `更新 ${taipeiDay(createdAt)}-${updateId.replace(/-/g, '').toLowerCase().slice(-6)}`;
}
export function hexId(updateId: string): string { return updateId.replace(/-/g, '').toLowerCase(); }
/** The store build's completion, rounded up to a whole second: expo-updates stores commit times as
 * Int64(seconds * 1000), which turns a fractional millisecond value into one less (UpdatesDatabaseUtils.swift). */
export function embeddedCommitTime(store: Pick<StoreBuild, 'completedAt'>): number { return Math.ceil(Date.parse(store.completedAt) / 1000) * 1000; }

/** The newest store build of a runtime; without a runtime (group not found) the newest store build overall. */
export function storeBuildFor(builds: readonly StoreBuild[], runtime: string | null): StoreBuild | null {
  const pool = runtime ? builds.filter(build => build.runtime === runtime) : [...builds];
  const version = (value: string) => value.split('.').map(part => Number(part));
  pool.sort((a, b) => {
    const [x, y] = [version(a.version), version(b.version)];
    for (let index = 0; index < Math.max(x.length, y.length); index += 1) if ((x[index] ?? 0) !== (y[index] ?? 0)) return (y[index] ?? 0) - (x[index] ?? 0);
    return Number(b.buildNumber) - Number(a.buildNumber);
  });
  return pool[0] ?? null;
}

/** The Google sign-in URL scheme the production export composed (public: it ships inside every IPA). */
export function googleIosUrlScheme(config: Record<string, unknown> | null): string | null {
  const plugins = Array.isArray(config?.plugins) ? config.plugins : [];
  for (const plugin of plugins) {
    if (Array.isArray(plugin) && plugin[0] === 'react-native-nitro-google-signin') {
      const scheme = (plugin[1] as { iosUrlScheme?: unknown } | undefined)?.iosUrlScheme;
      if (typeof scheme === 'string' && /^[A-Za-z][A-Za-z0-9+.-]{2,200}$/.test(scheme)) return scheme;
    }
  }
  return null;
}

/** Native-relevant config of the simulator build vs the production export; only the channel may differ. */
export function configDifferences(built: Record<string, unknown> | null, production: Record<string, unknown> | null, channel: Channel): string[] | null {
  if (!built || !production) return null;
  const pick = (config: Record<string, unknown>) => {
    const updates = { ...(config.updates as Record<string, unknown> | undefined) };
    delete updates.requestHeaders;
    return { name: config.name, slug: config.slug, scheme: config.scheme, version: config.version, sdkVersion: config.sdkVersion, runtimeVersion: config.runtimeVersion, ios: config.ios, plugins: config.plugins, updates };
  };
  const [a, b] = [pick(built), pick(production)];
  const differences = Object.keys(a).filter(key => JSON.stringify((a as Record<string, unknown>)[key]) !== JSON.stringify((b as Record<string, unknown>)[key]));
  const headers = (built.updates as { requestHeaders?: Record<string, string> } | undefined)?.requestHeaders;
  if (headers?.['expo-channel-name'] !== channel) differences.push('updates.requestHeaders');
  return differences;
}

export function hierarchyTexts(raw: string): string[] | null {
  let tree: unknown;
  try { tree = JSON.parse(raw); } catch { return null; }
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const attributes = (node as { attributes?: Record<string, unknown> }).attributes ?? {};
    for (const key of ['accessibilityText', 'text', 'value', 'hintText']) {
      const value = attributes[key];
      if (typeof value === 'string' && value.trim()) texts.push(value.trim());
    }
    for (const child of (node as { children?: unknown[] }).children ?? []) walk(child);
  };
  walk(tree);
  return [...new Set(texts)];
}

export function parseDbRows(text: string): DbRow[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line) => {
    const [id, commitTime, status, ok, failed] = line.split('|');
    return { id: id.toLowerCase(), commitTime: Number(commitTime), status: Number(status), successfulLaunches: Number(ok), failedLaunches: Number(failed) };
  });
}

const pass = (id: string, name: string, detail: string): Check => ({ id, name, status: 'PASS', detail });
const fail = (id: string, name: string, detail: string): Check => ({ id, name, status: 'FAIL', detail });

/** The day's reading the reader must open on: the plan entry for today in Taipei (data/reading-plan-2026.json). */
export function expectedReading(today: string): { date: string; inPlan: boolean; label: string; references: string[] } {
  const date = getInitialReadingDate(canonicalReadingPlan, today);
  const references = getReadingDay(canonicalReadingPlan, date)?.references ?? [];
  return { date, inPlan: Boolean(getReadingDay(canonicalReadingPlan, today)), label: `YouVersion原生閱讀器：${formatReferenceListZhTw(references)}`, references };
}

export function judge(evidence: Evidence): Verdict {
  const checks: Check[] = [];
  const r = evidence.resolve;
  const expected = r?.expected ?? null;
  const store = r?.store ?? null;

  // 1. The group names one iOS update of a runtime the App Store build has.
  if (!r) checks.push(fail('group', '要驗的 iOS update', '沒有 resolve.json (量不到)'));
  else if (!expected) checks.push(fail('group', '要驗的 iOS update', `group ${r.groupId} 查不到 iOS update (${r.group.status ?? r.group.error})`));
  else if (r.group.updateGroup !== r.groupId) checks.push(fail('group', '要驗的 iOS update', `manifest 的 group 是 ${r.group.updateGroup}，不是 ${r.groupId}`));
  else if (!store) checks.push(fail('group', '要驗的 iOS update', `runtime ${expected.runtimeVersion} 沒有登記的商店 build (scripts/ios/store-builds.json)`));
  else checks.push(pass('group', '要驗的 iOS update', `update ${expected.updateId}，runtime ${expected.runtimeVersion}，${r.group.branchName ?? '?'} 分支，${expected.createdAt}`));

  // 2. What the channel serves this runtime right now: only that can reach the phone.
  if (!r) checks.push(fail('channel', '頻道現在發的就是它', '量不到'));
  else if (!expected) checks.push(fail('channel', '頻道現在發的就是它', `${r.channel} 現在發 ${r.channelNow.updateId ?? `沒有 (${r.channelNow.status ?? r.channelNow.error})`}，要驗的 group 沒有 iOS update`));
  else if (r.channelNow.updateId !== expected.updateId) checks.push(fail('channel', '頻道現在發的就是它', `${r.channel} 現在發 ${r.channelNow.updateId ?? `沒有 (${r.channelNow.status ?? r.channelNow.error})`}，不是 ${expected.updateId}`));
  else checks.push(pass('channel', '頻道現在發的就是它', `${r.channel} 對 runtime ${expected.runtimeVersion} 發 ${expected.updateId}`));

  // 3. Native layer = the App Store build (same commit, version, build number, runtime and update policy).
  const n = evidence.native;
  if (!n || !store || !r) {
    checks.push(fail('native', '原生層 = 商店 build', '量不到 (沒有 native.json 或商店 build)'));
    checks.push(fail('embedded', '內建 update 時間 = 商店 build', '量不到'));
  } else {
    const wrong: string[] = [];
    if (n.sourceCommit !== store.commit) wrong.push(`commit ${n.sourceCommit} ≠ ${store.commit}`);
    if (n.bundleId !== BUNDLE_ID) wrong.push(`bundle ${n.bundleId}`);
    if (n.version !== store.version || n.buildNumber !== store.buildNumber) wrong.push(`版本 ${n.version} (${n.buildNumber}) ≠ ${store.version} (${store.buildNumber})`);
    if (n.updates.runtimeVersion !== store.runtime) wrong.push(`runtime ${String(n.updates.runtimeVersion)}`);
    if (n.updates.url !== `https://u.expo.dev/${r.projectId}`) wrong.push(`update URL ${String(n.updates.url)}`);
    if (n.updates.channel !== r.channel) wrong.push(`頻道 ${String(n.updates.channel)}`);
    if (n.updates.checkOnLaunch !== 'ERROR_RECOVERY_ONLY') wrong.push(`check-on-launch ${String(n.updates.checkOnLaunch)}`);
    if (String(n.updates.launchWaitMs) !== '0') wrong.push(`launch wait ${String(n.updates.launchWaitMs)}`);
    if (n.updates.enabled !== true) wrong.push('expo-updates 沒開');
    if (n.configDifferences === null) wrong.push('原生設定組成量不到');
    else if (n.configDifferences.length) wrong.push(`和正式匯出的設定不同：${n.configDifferences.join(', ')}`);
    checks.push(wrong.length ? fail('native', '原生層 = 商店 build', wrong.join('；'))
      : pass('native', '原生層 = 商店 build', `commit ${store.commit.slice(0, 7)}，${store.version} (${store.buildNumber})，runtime ${store.runtime}，頻道 ${r.channel}，ERROR_RECOVERY_ONLY；原生設定組成和正式匯出相同 (只差頻道)`));
    const target = embeddedCommitTime(store);
    const embeddedRow = evidence.launch1?.rows.find(row => row.status === STATUS_EMBEDDED);
    const timeWrong: string[] = [];
    if (n.embedded.commitTime !== target) timeWrong.push(`app.manifest commitTime ${n.embedded.commitTime} ≠ ${target}`);
    if (!embeddedRow) timeWrong.push('expo-updates 資料庫沒有內建 update (量不到)');
    else if (embeddedRow.commitTime !== target) timeWrong.push(`資料庫的內建 update 時間 ${embeddedRow.commitTime} ≠ ${target}`);
    if (!n.signature.valid || !n.signature.entitlementsUnchanged) timeWrong.push(`簽章 ${n.signature.detail}`);
    checks.push(timeWrong.length ? fail('embedded', '內建 update 時間 = 商店 build', timeWrong.join('；'))
      : pass('embedded', '內建 update 時間 = 商店 build', `${store.completedAt} (EAS build ${store.easBuildId ?? '?'} 完成時間)；重簽後簽章有效、entitlements 不變`));
  }

  // 3b. The update under test talks only to the local fixture backend (never the real one) and is signed in there.
  const iso = evidence.isolation;
  if (!iso || !iso.apiHost || iso.redirectAnswered === null || iso.apiRequests === null) checks.push(fail('isolation', '只連本機假資料後端', '量不到'));
  else {
    const wrong: string[] = [];
    if (iso.apiHost.filesWithHost < 1) wrong.push(`下載的 update 裡找不到 https://${iso.apiHost.host} (掃了 ${iso.apiHost.filesScanned} 個檔)`);
    if (!iso.redirectAnswered) wrong.push(`${iso.apiHost.host} 沒有導到本機假資料後端`);
    if (iso.apiRequests < 1) wrong.push('第二次冷啟動沒有請求到本機假資料後端');
    checks.push(wrong.length ? fail('isolation', '只連本機假資料後端', wrong.join('；'))
      : pass('isolation', '只連本機假資料後端', `update 的 API ${iso.apiHost.host} 在這台 runner 指到本機假資料後端 (只信任這次的臨時根憑證)；第二次冷啟動 ${iso.apiRequests} 個請求都到本機`));
  }

  // 4. Cold start 1 downloaded exactly that update.
  const l1 = evidence.launch1;
  const ready1 = l1?.measured ? l1.rows.filter(row => row.status === STATUS_READY).map(row => row.id) : [];
  if (!l1?.measured) checks.push(fail('download', '第一次冷啟動下載它', `expo-updates 資料庫量不到 (${l1?.error ?? '沒有紀錄'})`));
  else if (!expected) checks.push(fail('download', '第一次冷啟動下載它', `下載了 ${ready1.join(', ') || '沒有'}，但要驗的 group 沒有 iOS update`));
  else if (!ready1.includes(hexId(expected.updateId))) checks.push(fail('download', '第一次冷啟動下載它', `下載好的是 ${ready1.join(', ') || '沒有'}，不是 ${hexId(expected.updateId)} (等了 ${evidence.download?.waitedSeconds ?? '?'} 秒)`));
  else checks.push(pass('download', '第一次冷啟動下載它', `${hexId(expected.updateId)} 已下載 (等了 ${evidence.download?.waitedSeconds ?? '?'} 秒)`));

  // 5. Cold start 2 runs it: the account page's version line and expo-updates' launch record agree.
  const l2 = evidence.launch2;
  const launched = l2?.measured ? l2.rows.filter(row => row.status === STATUS_READY && row.successfulLaunches > 0).map(row => row.id) : [];
  const versionLine = evidence.accountTexts?.find(text => /^版本 \S+/.test(text)) ?? null;
  const observedTail = /· 更新 (\d{8})-([0-9a-f]{6})$/.exec(versionLine ?? '')?.slice(1).join('-') ?? null;
  if (!evidence.accountTexts || !l2?.measured) checks.push(fail('running', '第二次冷啟動跑的是它', `量不到 (帳戶頁 ${evidence.accountTexts ? '有' : '沒有'}、資料庫 ${l2?.measured ? '有' : '沒有'})`));
  else if (!expected || !store) checks.push(fail('running', '第二次冷啟動跑的是它', `App 跑的是 ${launched.join(', ') || '內建版本'}，版本行「${versionLine ?? '沒有'}」；要驗的 group 沒有對得上的 update`));
  else {
    const label = `版本 ${store.version} (${store.buildNumber}) · ${expected.label}`;
    const wrong: string[] = [];
    if (versionLine !== label) wrong.push(`版本行「${versionLine ?? '沒有'}」≠「${label}」`);
    if (!launched.includes(hexId(expected.updateId))) wrong.push(`expo-updates 記錄成功啟動的是 ${launched.join(', ') || '沒有'}`);
    checks.push(wrong.length ? fail('running', '第二次冷啟動跑的是它', wrong.join('；')) : pass('running', '第二次冷啟動跑的是它', `「${label}」；expo-updates 記錄 ${hexId(expected.updateId)} 成功啟動`));
  }

  // 6. No crash, no ErrorRecovery.
  const e = evidence.end;
  const healthWrong: string[] = [];
  if (!e || e.appRunning === null || e.crashReports === null || e.jsFatalLines === null || e.errorRecoveryLines === null || e.expoErrorLog === null || e.updatesLogLines === null || !l2?.measured) healthWrong.push('量不到');
  else {
    if (!e.appRunning) healthWrong.push('最後 App 已經不在執行');
    if (e.crashReports.length) healthWrong.push(`閃退報告 ${e.crashReports.join(', ')}`);
    if (e.jsFatalLines.length) healthWrong.push(`JS 致命錯誤 ${e.jsFatalLines.length} 行`);
    if (e.errorRecoveryLines.length) healthWrong.push(`ErrorRecovery ${e.errorRecoveryLines.length} 行`);
    if (e.expoErrorLog) healthWrong.push('有 expo-error.log');
    if (e.updatesLogLines === 0) healthWrong.push('expo-updates 記錄是空的 (量不到)');
    const failed = l2.rows.filter(row => row.failedLaunches > 0);
    if (failed.length) healthWrong.push(`啟動失敗次數 ${failed.map(row => `${row.id}:${row.failedLaunches}`).join(', ')}`);
  }
  checks.push(healthWrong.length ? fail('health', '沒閃退、沒 ErrorRecovery', healthWrong.join('；'))
    : pass('health', '沒閃退、沒 ErrorRecovery', `App 執行中；閃退報告 0；JS 致命錯誤 0；ErrorRecovery 0 (expo-updates 記錄 ${e!.updatesLogLines} 行)；每個 update 的啟動失敗次數 0`));

  // 7. The reader opens on today's reading (Taipei date, data/reading-plan-2026.json).
  const reading = expectedReading(evidence.today);
  const readerWrong: string[] = [];
  const readerFlow = evidence.flows['1-reader-today'];
  if (!evidence.readerTexts) readerWrong.push('讀經頁畫面量不到');
  else {
    if (readerFlow !== 'PASS' && readerFlow !== 'RERUN-PASS') readerWrong.push(`流程 ${readerFlow ?? '沒跑'}`);
    if (!reading.inPlan) readerWrong.push(`今天 ${evidence.today} 不在讀經計畫裡`);
    if (!evidence.readerTexts.includes(reading.label)) readerWrong.push(`沒有「${reading.label}」，看到「${evidence.readerTexts.find(text => text.startsWith('YouVersion原生閱讀器')) ?? '沒有閱讀器'}」`);
    reading.references.forEach((_, index) => {
      const chip = `今日第${index + 1}段，共${reading.references.length}段`;
      if (!evidence.readerTexts!.some(text => text.endsWith(chip))) readerWrong.push(`少了「…${chip}」`);
    });
    if (evidence.readerTexts.some(text => /^官方閱讀器還在準備中/.test(text))) readerWrong.push('閱讀器還在準備中');
  }
  checks.push(readerWrong.length ? fail('reader', '讀經頁打得開、日期正確', readerWrong.join('；'))
    : pass('reader', '讀經頁打得開、日期正確', `${evidence.today} (台北) 打開「${reading.label.replace('YouVersion原生閱讀器：', '')}」，每段標「今日第 N 段」`));

  const observed = [...new Set([...launched, ...(observedTail ? [observedTail] : [])])];
  return { verdict: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL', groupId: r?.groupId ?? null, expectedUpdateId: expected?.updateId ?? null, observedUpdateIds: observed, checks };
}

export function verdictMarkdown(result: Verdict): string {
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [
    `### iPhone OTA 模擬器驗收：${result.verdict}`,
    '',
    `group \`${result.groupId ?? '?'}\`；要驗的 update \`${result.expectedUpdateId ?? '沒有'}\`；App 實際跑的 \`${result.observedUpdateIds.join(', ') || '內建版本'}\``,
    '',
    '| 項目 | 結果 | 證據 |',
    '|---|---|---|',
    ...result.checks.map(check => `| ${cell(check.name)} | ${check.status} | ${cell(check.detail)} |`),
    '',
  ].join('\n');
}

// ---------- side-effecting subcommands (macOS runner) ----------

const run = (command: string, args: string[], options: { allowFail?: boolean } = {}): string => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (options.allowFail) return '';
    throw error;
  }
};
const readJson = <T>(path: string): T | null => { try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; } };
const writeJson = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };
const repoRoot = () => resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function fetchManifest(url: string, headers: Record<string, string>): Promise<{ fetch: ManifestFetch; manifest: UpdateManifest | null }> {
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'expo-platform': 'ios', 'expo-protocol-version': '1', accept: 'multipart/mixed,application/expo+json,application/json', ...headers }, signal: AbortSignal.timeout(30_000) });
      const body = await response.text();
      const manifest = response.status === 200 ? parseManifestResponse(response.headers.get('content-type'), body) : null;
      const error = response.status === 200 && !manifest ? 'unparseable manifest' : null;
      return { fetch: { url, status: response.status, updateId: manifest?.id ?? null, error }, manifest };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { fetch: { url, status: null, updateId: null, error: lastError }, manifest: null };
}

async function resolveCommand(groupId: string, channelInput: string, out: string): Promise<number> {
  const root = repoRoot();
  const channel = (CHANNELS as readonly string[]).includes(channelInput) ? channelInput as Channel : null;
  if (!channel) { console.error(`channel must be one of ${CHANNELS.join(', ')}`); return 1; }
  const projectId = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.extra.eas.projectId as string;
  const builds = (JSON.parse(readFileSync(join(root, 'scripts/ios/store-builds.json'), 'utf8')) as { builds: StoreBuild[] }).builds;
  // The group ID goes into a URL path: anything that is not a UUID is never sent.
  const group = UUID.test(groupId)
    ? await fetchManifest(`https://u.expo.dev/${projectId}/group/${groupId.toLowerCase()}`, {})
    : { fetch: { url: '', status: null, updateId: null, error: 'not a UUID' }, manifest: null };
  const manifest = group.manifest;
  const store = storeBuildFor(builds, manifest?.runtimeVersion ?? null);
  const runtime = store?.runtime ?? null;
  const channelNow = runtime
    ? await fetchManifest(`https://u.expo.dev/${projectId}`, { 'expo-channel-name': channel, 'expo-runtime-version': runtime })
    : { fetch: { url: '', status: null, updateId: null, error: 'no store build' }, manifest: null };
  const productionConfig = (manifest ?? channelNow.manifest)?.extra?.expoClient ?? null;
  const record: ResolveRecord = {
    groupId, channel, projectId,
    group: { ...group.fetch, updateGroup: manifest?.metadata?.updateGroup ?? null, branchName: manifest?.metadata?.branchName ?? null, createdAt: manifest?.createdAt ?? null, runtimeVersion: manifest?.runtimeVersion ?? null },
    channelNow: { ...channelNow.fetch, updateGroup: channelNow.manifest?.metadata?.updateGroup ?? null },
    store,
    expected: manifest && manifest.metadata?.updateGroup?.toLowerCase() === groupId.toLowerCase()
      ? { updateId: manifest.id, createdAt: manifest.createdAt, runtimeVersion: manifest.runtimeVersion, label: updateLabelSuffix(manifest.id, manifest.createdAt) }
      : null,
    resolvedAt: new Date().toISOString(),
  };
  writeJson(join(out, 'resolve.json'), record);
  // The export's composed Expo config (public manifest data) feeds the native comparison; it is not uploaded.
  writeJson(join(out, 'work', 'production-config.json'), productionConfig);
  console.log(`group ${groupId}: ${record.expected ? `iOS update ${record.expected.updateId} (runtime ${record.expected.runtimeVersion})` : `no iOS update (${group.fetch.status ?? group.fetch.error})`}`);
  console.log(`${channel} serves runtime ${runtime ?? '?'}: ${channelNow.fetch.updateId ?? `nothing (${channelNow.fetch.status ?? channelNow.fetch.error})`}`);
  if (!store) {
    console.error(`No App Store build is registered for runtime ${manifest?.runtimeVersion ?? '?'}: add it to scripts/ios/store-builds.json.`);
    return 1;
  }
  console.log(`store build ${store.version} (${store.buildNumber}) from ${store.commit}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `native_commit=${store.commit}\nruntime=${store.runtime}\n`);
  const scheme = googleIosUrlScheme(productionConfig);
  if (scheme && process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME=${scheme}\n`);
  return 0;
}

const plist = (path: string): Record<string, unknown> | null => {
  if (!existsSync(path)) return null;
  try { return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path])) as Record<string, unknown>; } catch { return null; }
};
const findFile = (dir: string, name: string): string | null => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory() && entry.name.endsWith('.bundle')) { const found = findFile(path, name); if (found) return found; }
  }
  return null;
};
const entitlements = (app: string) => run('codesign', ['-d', '--entitlements', '-', '--xml', app], { allowFail: true }).trim();

async function nativeCommand(app: string, out: string, nativeDir: string): Promise<number> {
  const r = readJson<ResolveRecord>(join(out, 'resolve.json'));
  if (!r?.store) { console.error('resolve.json has no store build'); return 1; }
  const info = plist(join(app, 'Info.plist'));
  const expo = plist(join(app, 'Expo.plist'));
  const manifestPath = join(app, 'EXUpdates.bundle', 'app.manifest');
  const target = embeddedCommitTime(r.store);
  let original: number | null = null;
  let written: number | null = null;
  const before = entitlements(app);
  let signature = { valid: false, entitlementsUnchanged: false, detail: 'not signed' };
  if (existsSync(manifestPath)) {
    // The store binary's embedded update was created during its EAS build, before any OTA of that runtime;
    // expo-updates only takes a downloaded update that is newer (LoaderSelectionPolicyFilterAware). A simulator
    // app built today would refuse every published OTA, so it gets the store build's completion time instead.
    const embedded = JSON.parse(readFileSync(manifestPath, 'utf8')) as { commitTime?: number };
    original = typeof embedded.commitTime === 'number' ? embedded.commitTime : null;
    embedded.commitTime = target;
    writeFileSync(manifestPath, JSON.stringify(embedded));
    written = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { commitTime?: number }).commitTime ?? null;
    try {
      run('codesign', ['--force', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags', '--timestamp=none', app]);
      run('codesign', ['--verify', '--strict', app]);
      const after = entitlements(app);
      signature = { valid: true, entitlementsUnchanged: before === after, detail: before === after ? `valid, entitlements unchanged (${before.length} bytes)` : 'entitlements changed' };
    } catch (error) {
      signature = { valid: false, entitlementsUnchanged: false, detail: error instanceof Error ? error.message.split('\n')[0] : String(error) };
    }
  }
  const configPath = findFile(app, 'app.config');
  const built = configPath ? readJson<Record<string, unknown>>(configPath) : null;
  const headers = (expo?.EXUpdatesRequestHeaders ?? {}) as Record<string, unknown>;
  const urlTypes = (info?.CFBundleURLTypes ?? []) as Array<{ CFBundleURLSchemes?: string[] }>;
  const record: NativeRecord = {
    sourceCommit: run('git', ['-C', nativeDir, 'rev-parse', 'HEAD'], { allowFail: true }).trim() || null,
    bundleId: (info?.CFBundleIdentifier as string) ?? null,
    version: (info?.CFBundleShortVersionString as string) ?? null,
    buildNumber: (info?.CFBundleVersion as string) ?? null,
    urlSchemes: urlTypes.flatMap(type => type.CFBundleURLSchemes ?? []).map(scheme => scheme.startsWith('com.googleusercontent.apps.') ? 'com.googleusercontent.apps.<production client>' : scheme),
    updates: {
      enabled: expo?.EXUpdatesEnabled, url: expo?.EXUpdatesURL, runtimeVersion: expo?.EXUpdatesRuntimeVersion,
      channel: headers['expo-channel-name'], checkOnLaunch: expo?.EXUpdatesCheckOnLaunch, launchWaitMs: expo?.EXUpdatesLaunchWaitMs,
      hasEmbeddedUpdate: expo?.EXUpdatesHasEmbeddedUpdate,
    },
    embedded: { originalCommitTime: original, commitTime: written, targetCommitTime: target },
    signature,
    configDifferences: configDifferences(built, readJson<Record<string, unknown>>(join(out, 'work', 'production-config.json')), r.channel),
  };
  writeJson(join(out, 'native.json'), record);
  console.log(JSON.stringify({ ...record.updates, version: record.version, build: record.buildNumber, embedded: record.embedded, signature: record.signature.detail, configDifferences: record.configDifferences }));
  return 0;
}

const appData = (udid: string) => run('xcrun', ['simctl', 'get_app_container', udid, BUNDLE_ID, 'data'], { allowFail: true }).trim();
const DB_SQL = "SELECT CASE typeof(id) WHEN 'blob' THEN lower(hex(id)) ELSE lower(replace(id, '-', '')) END, commit_time, status, successful_launch_count, failed_launch_count FROM updates ORDER BY commit_time;";
export function readDb(udid: string): DbRecord {
  const data = appData(udid);
  if (!data) return { measured: false, rows: [], error: 'no app data container' };
  const dir = join(data, 'Documents', '.expo-internal');
  const db = existsSync(dir) ? readdirSync(dir).filter(name => /^expo-v\d+\.db$/.test(name)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]))[0] : undefined;
  if (!db) return { measured: false, rows: [], error: 'no expo-updates database' };
  try {
    return { measured: true, rows: parseDbRows(run('sqlite3', ['-separator', '|', '-cmd', '.timeout 5000', join(dir, db), DB_SQL])), error: null };
  } catch (error) {
    return { measured: false, rows: [], error: error instanceof Error ? error.message.split('\n')[0] : String(error) };
  }
}

async function waitDownloadCommand(udid: string, out: string, seconds: number): Promise<number> {
  const started = Date.now();
  let ready: string[] = [];
  while (Date.now() - started < seconds * 1000) {
    await new Promise(done => setTimeout(done, 3000));
    const db = readDb(udid);
    ready = db.rows.filter(row => row.status === STATUS_READY).map(row => row.id);
    if (ready.length) break;
  }
  // fetchUpdateAsync marks the update ready after its last asset; give the JS promise a moment to settle.
  await new Promise(done => setTimeout(done, 3000));
  writeJson(join(out, 'download.json'), { waitedSeconds: Math.round((Date.now() - started) / 1000), readyIds: ready });
  console.log(ready.length ? `ready: ${ready.join(', ')}` : `nothing downloaded in ${seconds} s`);
  return 0;
}

async function apiHostCommand(udid: string, out: string, host: string): Promise<number> {
  const data = appData(udid);
  const dir = data ? join(data, 'Documents', '.expo-internal') : '';
  const needle = Buffer.from(`https://${host}`);
  let filesScanned = 0;
  let filesWithHost = 0;
  if (dir && existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (/\.db(-wal|-shm)?$/.test(name)) continue;
      const path = join(dir, name);
      if (!statSync(path).isFile()) continue;
      filesScanned += 1;
      if (readFileSync(path).includes(needle)) filesWithHost += 1;
    }
  }
  writeJson(join(out, 'api-host.json'), { host, filesWithHost, filesScanned });
  console.log(`${filesWithHost} of ${filesScanned} downloaded files name https://${host}`);
  return 0;
}

/** The API host's TLS listener on both loopback families (the name maps to 127.0.0.1 and ::1), to the fixture. */
function apiProxyCommand(port: number, target: number, log: string, certFile: string, keyFile: string): Promise<number> {
  const forward = (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const safePath = redactEvidence(incoming.url ?? '');
    appendFileSync(log, `${Date.now()} ${incoming.method} ${safePath}\n`);
    const upstream = request({ host: '127.0.0.1', port: target, path: incoming.url, method: incoming.method, headers: incoming.headers, agent: false }, (response) => {
      const status = response.statusCode ?? 502;
      appendFileSync(log, `${Date.now()} = ${status} ${safePath}\n`);
      outgoing.writeHead(status, response.headers);
      response.pipe(outgoing);
    });
    upstream.on('error', () => {
      appendFileSync(log, `${Date.now()} = 502 ${safePath} OTA_API_PROXY_ERROR\n`);
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  };
  const options = { cert: readFileSync(certFile), key: readFileSync(keyFile) };
  for (const address of ['127.0.0.1', '::1']) createTlsServer(options, forward).listen(port, address);
  return new Promise<number>(() => undefined); // runs until ota-sim-run.sh stops it
}

async function collectCommand(udid: string, out: string, since: string): Promise<number> {
  const app = readFileSync(join(out, 'app-path.txt'), 'utf8').trim();
  const exe = (plist(join(app, 'Info.plist'))?.CFBundleExecutable as string | undefined) ?? null;
  const data = appData(udid);
  const launchctl = run('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'], { allowFail: true });
  const appRunning = launchctl ? launchctl.split('\n').some(line => line.includes(`UIKitApplication:${BUNDLE_ID}`) && /^\d+\s/.test(line.trim())) : null;
  const sinceMs = Date.parse(since);
  const reports = join(homedir(), 'Library', 'Logs', 'DiagnosticReports');
  const crashReports = exe && Number.isFinite(sinceMs)
    ? (existsSync(reports) ? readdirSync(reports).filter(name => name.includes(exe) && statSync(join(reports, name)).mtimeMs >= sinceMs) : [])
    : null;
  // `log show --start` takes the runner's local time; the workflow passes `date '+%Y-%m-%d %H:%M:%S'`.
  const localSince = run('date', ['-r', String(Math.floor(sinceMs / 1000)), '+%Y-%m-%d %H:%M:%S'], { allowFail: true }).trim();
  const appLog = exe && localSince ? run('xcrun', ['simctl', 'spawn', udid, 'log', 'show', '--start', localSince, '--style', 'compact', '--predicate', `process == "${exe}"`], { allowFail: true }) : '';
  const jsFatalLines = exe && localSince ? appLog.split('\n').filter(line => /Unhandled JS Exception|Terminating app due to uncaught exception|RCTFatal|Fatal JS/i.test(line)) : null;
  writeFileSync(join(out, 'js-fatal.txt'), (jsFatalLines ?? ['(not measured)']).slice(0, 200).join('\n'));
  const logFile = data ? join(data, 'Library', 'Application Support', 'dev.expo.modules.core.logging.expo-updates.txt') : '';
  let updatesLogLines: number | null = null;
  let errorRecoveryLines: string[] | null = null;
  if (logFile && existsSync(logFile)) {
    copyFileSync(logFile, join(out, 'expo-updates-log.txt'));
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    updatesLogLines = lines.length;
    errorRecoveryLines = lines.filter(line => line.includes('ErrorRecovery'));
  }
  const errorLog = data ? join(data, 'Documents', 'expo-error.log') : '';
  const expoErrorLog = data ? existsSync(errorLog) : null;
  if (expoErrorLog) copyFileSync(errorLog, join(out, 'expo-error-log.txt'));
  const end: EndState = {
    appRunning, crashReports, jsFatalLines, updatesLogLines, errorRecoveryLines, expoErrorLog,
    simulatorClock: run('xcrun', ['simctl', 'spawn', udid, 'date', '+%Y-%m-%d %H:%M:%S %Z'], { allowFail: true }).trim() || null,
  };
  writeJson(join(out, 'end-state.json'), end);
  console.log(JSON.stringify({ ...end, jsFatalLines: jsFatalLines?.length ?? null, errorRecoveryLines: errorRecoveryLines?.length ?? null }));
  return 0;
}

export function loadEvidence(out: string, now = new Date()): Evidence {
  // The Taipei date when the reader was on screen (ota-sim-run.sh), so a run across midnight compares the same day.
  const readerDay = existsSync(join(out, 'reader-day.txt')) ? readFileSync(join(out, 'reader-day.txt'), 'utf8').trim() : '';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(readerDay) ? readerDay : taipeiToday(now);
  const texts = (name: string) => { const path = join(out, `hierarchy-${name}.json`); return existsSync(path) ? hierarchyTexts(readFileSync(path, 'utf8')) : null; };
  const apiLog = join(out, 'requests-api.log');
  const redirect = readJson<{ answered?: boolean }>(join(out, 'api-redirect.json'));
  return {
    resolve: readJson<ResolveRecord>(join(out, 'resolve.json')),
    native: readJson<NativeRecord>(join(out, 'native.json')),
    isolation: {
      apiHost: readJson(join(out, 'api-host.json')),
      redirectAnswered: typeof redirect?.answered === 'boolean' ? redirect.answered : null,
      apiRequests: existsSync(apiLog) ? readFileSync(apiLog, 'utf8').split('\n').filter(line => /^\d+ [A-Z]+ /.test(line)).length : null,
    },
    download: readJson(join(out, 'download.json')),
    launch1: readJson<DbRecord>(join(out, 'db-launch1.json')),
    launch2: readJson<DbRecord>(join(out, 'db-launch2.json')),
    flows: readJson<Record<string, string>>(join(out, 'flows.json')) ?? {},
    readerTexts: texts('1-reader-today'),
    accountTexts: texts('2-account-version'),
    end: readJson<EndState>(join(out, 'end-state.json')),
    today,
  };
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case 'resolve': return resolveCommand(args[0] ?? '', args[1] ?? '', args[2] ?? 'ota-out');
    case 'native': return nativeCommand(args[0], args[1] ?? 'ota-out', args[2] ?? 'native');
    case 'wait-download': return waitDownloadCommand(args[0], args[1] ?? 'ota-out', Number(args[2] ?? 300));
    case 'api-host': return apiHostCommand(args[0], args[1] ?? 'ota-out', args[2]);
    case 'api-proxy': return apiProxyCommand(Number(args[0]), Number(args[1]), args[2], args[3], args[4]);
    case 'db': writeJson(args[1], readDb(args[0])); return 0;
    case 'collect': return collectCommand(args[0], args[1] ?? 'ota-out', args[2]);
    case 'verdict': {
      const out = args[0] ?? 'ota-out';
      const result = judge(loadEvidence(out));
      writeJson(join(out, 'verdict.json'), result);
      console.log(verdictMarkdown(result));
      return result.verdict === 'PASS' ? 0 : 1;
    }
    default:
      console.error('usage: ota-verify.ts resolve|native|wait-download|db|collect|verdict ...');
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, (error) => { console.error(error); process.exitCode = 1; });
}
