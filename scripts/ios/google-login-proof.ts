import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { redactEvidence } from './sanitize-evidence';
import { googleLoginFixture as input } from './google-login-fixture';

// Manual wiring proof uses synthetic clients with the production config composition and a new simulator.
// Only the supervisor-approved native iOS Continue is clicked once. The Google page receives no input or clicks.
const out = 'ci-google'; mkdirSync(out, { recursive: true });
const receipt: Record<string, unknown> = { verdict: 'FAIL', sourceCommit: process.env.GITHUB_SHA, observedAt: new Date().toISOString() };
const secrets: string[] = [];
let device: string | undefined;
const env: NodeJS.ProcessEnv = { ...process.env, EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' };
function run(exe: string, args: string[], cwd?: string): string {
  const result = spawnSync(exe, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    writeFileSync(`${out}/failure.redacted.txt`, redactEvidence((result.stdout || '') + (result.stderr || ''), secrets));
    throw Error(`${exe} failed (${result.status})`);
  }
  return result.stdout;
}
try {
  if (env.QM_IOS_PRODUCTION_CONFIG) throw Error('Real/protected config is forbidden in this synthetic wiring proof');
  const values = {
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: input.webClientId,
    EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME: input.iosUrlScheme,
    EXPO_PUBLIC_QINGMU_API_BASE_URL: input.apiBaseUrl,
    EXPO_PUBLIC_YOUVERSION_APP_KEY: input.youVersionAppKey,
    EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE: 'true', EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true',
  };
  if (Object.values(values).some(value => typeof value !== 'string' || !value)) throw Error('Missing production input');
  if (input.iosBundleId !== 'org.qingmu.youth' || input.iosClientId !== input.iosUrlScheme.split('.').reverse().join('.')) throw Error('Google client binding mismatch');
  for (const key of Object.keys(env)) if (key.startsWith('EXPO_PUBLIC_')) delete env[key];
  Object.assign(env, values);
  secrets.push(input.webClientId, input.iosUrlScheme, input.apiBaseUrl, values.EXPO_PUBLIC_YOUVERSION_APP_KEY!, input.iosClientId);
  const hostname = new URL(input.apiBaseUrl).hostname;
  secrets.push(hostname);
  if (hostname !== 'qingmu-ci.invalid') throw Error('Only the isolated synthetic endpoint is allowed');
  run('sudo', ['sh', '-c', `printf '\n127.0.0.1 ${hostname}\n::1 ${hostname}\n' >> /etc/hosts`]);
  const resolution = run('dscacheutil', ['-q', 'host', '-a', 'name', hostname]);
  if (!resolution.includes('127.0.0.1')) throw Error('Production backend isolation failed');
  receipt.backendIsolation = 'synthetic .invalid endpoint observed to resolve to loopback before launch; no production endpoint configured';
  receipt.proofScope = 'synthetic native wiring only; true OAuth values are separately bound by local preflight';
  receipt.sourceTree = run('git', ['rev-parse', 'HEAD^{tree}']).trim();
  receipt.nodeVersion = process.version;
  receipt.xcodeVersion = run('xcodebuild', ['-version']).trim();
  const config = JSON.parse(run('npx', ['expo', 'config', '--type', 'public', '--json']));
  const app = JSON.parse(readFileSync('app.json', 'utf8')).expo;
  if (config.ios.bundleIdentifier !== 'org.qingmu.youth' || config.ios.buildNumber !== String(app.android.versionCode)) throw Error('Production config identity mismatch');
  writeFileSync(`${out}/public-config.redacted.json`, redactEvidence(JSON.stringify(config, null, 2), secrets));
  receipt.bundleIdentifier = config.ios.bundleIdentifier;
  receipt.buildNumber = config.ios.buildNumber;
  receipt.environmentNames = Object.keys(values);
  receipt.inputDigest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  receipt.packageLockSha256 = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
  run('npx', ['expo', 'prebuild', '--platform', 'ios', '--no-install', '--clean']);
  run('pod', ['install'], 'ios');
  const workspace = readdirSync('ios').find(name => name.endsWith('.xcworkspace'))!;
  const scheme = workspace.replace('.xcworkspace', '');
  run('xcodebuild', ['-workspace', `ios/${workspace}`, '-scheme', scheme, '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'build/google', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=', 'COMPILER_INDEX_STORE_ENABLE=NO', 'build']);
  const products = 'build/google/Build/Products/Release-iphonesimulator';
  const appPath = join(products, readdirSync(products).find(name => name.endsWith('.app'))!);
  const plist = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(appPath, 'Info.plist')]));
  const callbackPresent = plist.CFBundleURLTypes?.some((item: { CFBundleURLSchemes?: string[] }) => item.CFBundleURLSchemes?.includes(input.iosUrlScheme));
  if (plist.CFBundleIdentifier !== input.iosBundleId || plist.CFBundleVersion !== String(app.android.versionCode) || !callbackPresent) throw Error('Rendered native Info.plist does not match the input binding');
  receipt.builtInfoPlist = { bundleIdentifier: plist.CFBundleIdentifier, buildNumber: plist.CFBundleVersion, callbackSchemeMatches: callbackPresent };
  const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).devices;
  const selected = (Object.values(devices).flat() as { name: string; udid: string; state: string; deviceTypeIdentifier: string }[]).find(item => item.name.startsWith('iPhone'))!;
  const runtime = Object.entries(devices).find(([, list]) => (list as { udid: string }[]).some(item => item.udid === selected.udid))![0];
  device = run('xcrun', ['simctl', 'create', 'Qingmu isolated Google proof', selected.deviceTypeIdentifier, runtime]).trim();
  receipt.device = { udid: device, name: selected.name, runtime, newlyCreated: true };
  run('xcrun', ['simctl', 'boot', device]);
  run('xcrun', ['simctl', 'bootstatus', device, '-b']);
  run('xcrun', ['simctl', 'install', device, appPath]);
  env.MAESTRO_DRIVER_STARTUP_TIMEOUT = '600000';
  run(`${process.env.HOME}/.maestro/bin/maestro`, ['--device', device, 'hierarchy', '--no-reinstall-driver']);
  env.MAESTRO_DRIVER_STARTUP_TIMEOUT = '180000';
  run(`${process.env.HOME}/.maestro/bin/maestro`, ['--device', device, 'test', '--no-reinstall-driver', '.maestro/ios-production-google.yaml']);
  const hierarchy = run(`${process.env.HOME}/.maestro/bin/maestro`, ['--device', device, 'hierarchy', '--no-reinstall-driver']);
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(hierarchy)) throw Error('Account/email visible; screenshot withheld');
  run('xcrun', ['simctl', 'io', device, 'screenshot', `${out}/google-entry.png`]);
  receipt.screenshotSha256 = createHash('sha256').update(readFileSync(`${out}/google-entry.png`)).digest('hex');
  writeFileSync(`${out}/hierarchy.redacted.txt`, redactEvidence(hierarchy, secrets));
  receipt.screenshotPrivacy = 'new isolated simulator; live hierarchy checked for email before capture';
  receipt.observedGoogleDomain = /accounts\.google\.com/.test(hierarchy);
  receipt.observedGoogleClientError = /invalid_client|OAuth client was not found|Access blocked|Authorization Error|Error 40[01]|無效的用戶端|授權錯誤/i.test(hierarchy);
  if (!/Email or phone|電子郵件或電話/.test(hierarchy) && !(receipt.observedGoogleDomain && receipt.observedGoogleClientError)) throw Error('Google account/client-error page not reached after the approved native iOS authorization');
  receipt.verdict = 'PASS';
} catch (error) { receipt.reason = error instanceof Error ? error.message : 'Proof failed'; process.exitCode = 1; }
finally {
  if (device) spawnSync('xcrun', ['simctl', 'terminate', device, 'org.qingmu.youth'], { env, stdio: 'ignore' });
  writeFileSync(`${out}/receipt.json`, redactEvidence(JSON.stringify(receipt, null, 2), secrets));
  console.log(`Google entry proof: ${receipt.verdict}`);
}
