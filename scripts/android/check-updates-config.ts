// scripts/android/check-updates-config.ts — the Android counterpart of the iOS I5 guard (scripts/ios/guards.ts).
// usage: tsx scripts/android/check-updates-config.ts [--project <root>] [--check-on-launch ERROR_RECOVERY_ONLY|NEVER]
//
// android/ is untracked and written by `expo prebuild`; Gradle never reads app.json. expo-updates' runtime
// version, update URL, channel header and launch policy live in the generated AndroidManifest.xml and
// strings.xml, so a stale project (an older version, or one that predates expo-updates) builds an APK that
// never receives the OTAs published for its version. Run after prebuild and before Gradle; exit 1 stops the
// release. The default expectation is the official release (ERROR_RECOVERY_ONLY); the isolated CI build asks
// for NEVER. Node-only: no react-native imports (tests/tools/releaseScriptsLoad.test.ts).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CheckOnLaunch = 'ERROR_RECOVERY_ONLY' | 'NEVER';
export interface AndroidUpdatesExpectation { url: string; runtimeVersion: string; channel: string; checkOnLaunch: CheckOnLaunch }

const PREFIX = 'expo.modules.updates.';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const STRINGS = 'android/app/src/main/res/values/strings.xml';
const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attribute = (tag: string, name: string) => { const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return match ? decode(match[1]) : null; };

/** Every expo-updates <meta-data> in the manifest, attribute order and spacing as written by any tool. */
function updatesMetaData(manifest: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const [tag] of manifest.matchAll(/<meta-data\b[^>]*>/g)) {
    const name = attribute(tag, 'android:name'); const value = attribute(tag, 'android:value');
    if (name?.startsWith(PREFIX) && value !== null) result.set(name.slice(PREFIX.length), value);
  }
  return result;
}
function stringResource(strings: string | null, name: string): string | null {
  const match = strings ? new RegExp(`<string\\b[^>]*\\sname="${name}"[^>]*>([^<]*)</string>`).exec(strings) : null;
  return match ? decode(match[1]).trim() : null;
}

export function expectedAndroidUpdates(appJson: unknown, checkOnLaunch: CheckOnLaunch): AndroidUpdatesExpectation {
  const expo = (appJson as { expo?: { version?: unknown; extra?: { eas?: { projectId?: unknown } } } } | null)?.expo;
  return { url: `https://u.expo.dev/${String(expo?.extra?.eas?.projectId ?? '')}`, runtimeVersion: String(expo?.version ?? ''), channel: 'production', checkOnLaunch };
}

export function checkAndroidUpdatesConfig(files: { manifest: string | null; strings: string | null }, expected: AndroidUpdatesExpectation): string[] {
  if (files.manifest === null) return [`${MANIFEST} 不存在：先執行 npx expo prebuild --platform android --clean`];
  const meta = updatesMetaData(files.manifest);
  const problems: string[] = [];
  if (meta.get('ENABLED') !== 'true') problems.push(`ENABLED 是 ${meta.get('ENABLED') ?? '缺'}，expo-updates 必須啟用`);
  if (meta.get('EXPO_UPDATE_URL') !== expected.url) problems.push(`EXPO_UPDATE_URL 是 ${meta.get('EXPO_UPDATE_URL') ?? '缺'}，應為 ${expected.url}`);
  const runtimeRef = meta.get('EXPO_RUNTIME_VERSION');
  const runtime = runtimeRef === '@string/expo_runtime_version' ? stringResource(files.strings, 'expo_runtime_version') : runtimeRef ?? null;
  if (runtime !== expected.runtimeVersion) problems.push(`native runtime 是 ${runtime ?? '缺'}，app.json version 是 ${expected.runtimeVersion}；這個 APK 收不到同版本的 OTA`);
  let channel: unknown = null;
  try { channel = (JSON.parse(meta.get('UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY') ?? 'null') as Record<string, unknown> | null)?.['expo-channel-name'] ?? null; } catch { channel = 'unreadable'; }
  if (channel !== expected.channel) problems.push(`request header expo-channel-name 是 ${String(channel ?? '缺')}，應為 ${expected.channel}`);
  if (meta.get('EXPO_UPDATES_CHECK_ON_LAUNCH') !== expected.checkOnLaunch) problems.push(`EXPO_UPDATES_CHECK_ON_LAUNCH 是 ${meta.get('EXPO_UPDATES_CHECK_ON_LAUNCH') ?? '缺'}，應為 ${expected.checkOnLaunch}`);
  // fallbackToCacheTimeout 0: launch never waits for the network.
  if ((meta.get('EXPO_UPDATES_LAUNCH_WAIT_MS') ?? '0') !== '0') problems.push(`EXPO_UPDATES_LAUNCH_WAIT_MS 是 ${meta.get('EXPO_UPDATES_LAUNCH_WAIT_MS')}，啟動不可等待下載`);
  // Missing keys mean the SDK defaults (protection on, embedded update present), as on iOS.
  if (meta.get('DISABLE_ANTI_BRICKING_MEASURES') === 'true') problems.push('DISABLE_ANTI_BRICKING_MEASURES 被打開，防變磚保護必須保留');
  if (meta.get('HAS_EMBEDDED_UPDATE') === 'false') problems.push('HAS_EMBEDDED_UPDATE 是 false，必須保留內嵌版本');
  return problems;
}

function main(argv: string[]): number {
  const option = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const checkOnLaunch = option('--check-on-launch') ?? 'ERROR_RECOVERY_ONLY';
  if (checkOnLaunch !== 'ERROR_RECOVERY_ONLY' && checkOnLaunch !== 'NEVER') {
    console.error('usage: tsx scripts/android/check-updates-config.ts [--project <root>] [--check-on-launch ERROR_RECOVERY_ONLY|NEVER]');
    return 2;
  }
  const root = resolve(option('--project') ?? process.cwd());
  const read = (path: string) => existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null;
  let appJson: unknown = null;
  try { appJson = JSON.parse(read('app.json') ?? 'null'); } catch { appJson = null; }
  const expected = expectedAndroidUpdates(appJson, checkOnLaunch);
  const problems = appJson ? checkAndroidUpdatesConfig({ manifest: read(MANIFEST), strings: read(STRINGS) }, expected) : ['app.json 讀不到'];
  const detail = problems.length === 0
    ? `runtime ${expected.runtimeVersion}；${expected.channel}；${expected.checkOnLaunch}`
    : `${problems.join('；')}。改 app.json 後要重新執行 npx expo prebuild --platform android --clean，不要手改 android/`;
  console.log(`| Android 更新設定 | ${problems.length === 0 ? 'PASS' : 'FAIL'} | ${detail} |`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
