import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';
import { appVersionLabel } from '../../src/ui/accountSurface';
import {
  configDifferences, embeddedCommitTime, expectedReading, googleIosUrlScheme, hexId, hierarchyTexts, judge, parseDbRows, parseManifestResponse,
  plistKey, storeBuildFor, updateLabelSuffix, type Evidence, type StoreBuild,
} from '../../scripts/ios/ota-verify';

// The iPhone OTA acceptance on the simulator (.github/workflows/ios-ota-verify.yml). Shapes below were recorded
// 20261021 from the real EAS endpoints and expo-updates 56.0.28 (group cd676051…, update 01a15b89…20d84d).
const UPDATE = '01a15b89-dbbd-7910-a611-cd5d3e20d84d';
const GROUP = 'cd676051-203b-4fda-8a55-a87d1bcf4a42';
const CREATED = '2026-10-20T22:58:43.773Z';
const STORE: StoreBuild = { runtime: '0.5.35', version: '0.5.35', buildNumber: '60', commit: 'e9cb746c65477f7f9b8799d1100901f9c5225d89', easBuildId: 'ced6cd8e-939d-4319-8d10-432d8a5668f0', completedAt: '2026-10-20T00:45:20.732Z' };
const PROJECT = '2aa0b072-2f45-4e8c-a2bf-9d6f4c1e0887';
const BOUNDARY = '-----ExpoManifestBoundary-AaFbidu9eRCmEc1dPiDYTQ';
const multipart = (manifest: object) => [
  `--${BOUNDARY}`, 'Content-Disposition: form-data; name="manifest"', 'Content-Type: application/json', '', JSON.stringify(manifest),
  `--${BOUNDARY}`, 'Content-Disposition: form-data; name="extensions"', 'Content-Type: application/json', '', '{"assetRequestHeaders":{}}', `--${BOUNDARY}--`, '',
].join('\r\n');
const recorded = { id: UPDATE, createdAt: CREATED, runtimeVersion: '0.5.35', launchAsset: { key: 'bundle' }, assets: [], metadata: { updateGroup: GROUP, branchName: 'preview' }, extra: { expoClient: {} } };

function passingEvidence(): Evidence {
  const embedded = embeddedCommitTime(STORE);
  const id = hexId(UPDATE);
  return {
    resolve: {
      groupId: GROUP, channel: 'preview', projectId: PROJECT,
      group: { url: '', status: 200, updateId: UPDATE, error: null, updateGroup: GROUP, branchName: 'preview', createdAt: CREATED, runtimeVersion: '0.5.35' },
      channelNow: { url: '', status: 200, updateId: UPDATE, error: null, updateGroup: GROUP },
      store: STORE,
      expected: { updateId: UPDATE, createdAt: CREATED, runtimeVersion: '0.5.35', label: updateLabelSuffix(UPDATE, CREATED) },
      resolvedAt: '2026-10-21T00:00:00.000Z',
    },
    native: {
      sourceCommit: STORE.commit, bundleId: 'org.qingmu.youth', version: '0.5.35', buildNumber: '60', urlSchemes: ['org.qingmu.youth'],
      updates: { enabled: true, url: `https://u.expo.dev/${PROJECT}`, runtimeVersion: '0.5.35', channel: 'preview', checkOnLaunch: 'ERROR_RECOVERY_ONLY', launchWaitMs: 0, hasEmbeddedUpdate: true },
      embedded: { originalCommitTime: Date.parse('2026-10-21T00:20:00Z'), commitTime: embedded, targetCommitTime: embedded },
      signature: { valid: true, entitlementsUnchanged: true, detail: 'valid, entitlements unchanged' },
      configDifferences: [],
    },
    isolation: { apiHost: { host: 'api.example.test', filesWithHost: 1, filesScanned: 30 }, redirectAnswered: true, apiRequests: 18 },
    download: { waitedSeconds: 21, readyIds: [id] },
    launch1: { measured: true, error: null, rows: [{ id: 'aa'.repeat(16), commitTime: embedded, status: 5, successfulLaunches: 1, failedLaunches: 0 }, { id, commitTime: Date.parse(CREATED), status: 1, successfulLaunches: 0, failedLaunches: 0 }] },
    launch2: { measured: true, error: null, rows: [{ id, commitTime: Date.parse(CREATED), status: 1, successfulLaunches: 1, failedLaunches: 0 }] },
    flows: { '1-reader-today': 'PASS', '2-account-version': 'PASS' },
    readerTexts: ['更多閱讀工具', '使徒行傳 1，今日第1段，共3段', '詩篇 124，今日第2段，共3段', '詩篇 125，今日第3段，共3段', 'YouVersion原生閱讀器：徒1、詩124、詩125'],
    accountTexts: ['登入', '版本 0.5.35 (60) · 更新 20261021-20d84d'],
    end: { appRunning: true, crashReports: [], jsFatalLines: [], updatesLogLines: 42, errorRecoveryLines: [], expoErrorLog: false },
    today: '2026-10-21',
  };
}
const statusOf = (evidence: Evidence) => Object.fromEntries(judge(evidence).checks.map(check => [check.id, check.status]));

describe('iPhone OTA acceptance: which update', () => {
  it('reads the manifest part of the real multipart answer and nothing from a 404 text', () => {
    const manifest = parseManifestResponse(`multipart/mixed; boundary=${BOUNDARY}`, multipart(recorded));
    expect(manifest?.id).toBe(UPDATE);
    expect(manifest?.metadata).toEqual({ updateGroup: GROUP, branchName: 'preview' });
    expect(parseManifestResponse('text/plain; charset=utf-8', `There is no update identified by group ID "${GROUP}" and platform "android"`)).toBeNull();
    expect(parseManifestResponse('application/expo+json', JSON.stringify(recorded))?.id).toBe(UPDATE);
    expect(parseManifestResponse(`multipart/mixed; boundary=${BOUNDARY}`, multipart({ id: 'not-an-id', createdAt: CREATED, runtimeVersion: '0.5.35' }))).toBeNull();
  });

  it('expects the version line a phone in Taiwan shows: the Taipei day and the random end of the ID', () => {
    // 22:58 UTC on 10/20 is 06:58 on 10/21 in Taipei.
    expect(updateLabelSuffix(UPDATE, CREATED)).toBe('更新 20261021-20d84d');
    // Same format as the account page itself (src/ui/accountSurface.ts), at a moment that is the same day everywhere CI runs.
    const noon = '2026-10-21T04:00:00.000Z';
    expect(appVersionLabel('0.5.35', '60', { isEmbeddedLaunch: false, updateId: UPDATE, createdAt: new Date(noon) })).toBe(`版本 0.5.35 (60) · ${updateLabelSuffix(UPDATE, noon)}`);
  });

  it('rebuilds the newest store build of the runtime, and none for a runtime the store never had', () => {
    const older = { ...STORE, buildNumber: '59', commit: '4704907' };
    expect(storeBuildFor([older, STORE], '0.5.35')?.buildNumber).toBe('60');
    expect(storeBuildFor([older, STORE], '0.5.36')).toBeNull();
    expect(storeBuildFor([{ ...STORE, runtime: '0.5.34', version: '0.5.34', buildNumber: '58' }, STORE], null)?.version).toBe('0.5.35');
    const registered = JSON.parse(readFileSync('scripts/ios/store-builds.json', 'utf8')).builds as StoreBuild[];
    expect(storeBuildFor(registered, '0.5.35')).toMatchObject({ buildNumber: '60', commit: STORE.commit, completedAt: STORE.completedAt });
  });

  it('stores the embedded time as a whole second at or after the store build finished', () => {
    // 00:45:20.732 -> 00:45:21.000: expo-updates would truncate .732 ms arithmetic to a different integer.
    expect(new Date(embeddedCommitTime(STORE)).toISOString()).toBe('2026-10-20T00:45:21.000Z');
    expect(embeddedCommitTime(STORE)).toBeLessThan(Date.parse(CREATED));
  });

  it('takes the Google URL scheme only from the composed plugin entry', () => {
    expect(googleIosUrlScheme({ plugins: ['expo-router', ['react-native-nitro-google-signin', { iosUrlScheme: 'com.googleusercontent.apps.123-abc' }]] })).toBe('com.googleusercontent.apps.123-abc');
    expect(googleIosUrlScheme({ plugins: [['react-native-nitro-google-signin', { iosUrlScheme: 'x; rm -rf /' }]] })).toBeNull();
    expect(googleIosUrlScheme(null)).toBeNull();
  });

  it('allows only the channel to differ from the production export', () => {
    const production = { name: '竹科聖經', version: '0.5.35', ios: { buildNumber: '60' }, plugins: ['expo-router'], runtimeVersion: { policy: 'appVersion' }, updates: { url: 'u', requestHeaders: { 'expo-channel-name': 'production' } } };
    const built = { ...production, updates: { url: 'u', requestHeaders: { 'expo-channel-name': 'preview' } } };
    expect(configDifferences(built, production, 'preview')).toEqual([]);
    expect(configDifferences({ ...built, plugins: [] }, production, 'preview')).toEqual(['plugins']);
    expect(configDifferences(built, production, 'production')).toEqual(['updates.requestHeaders']);
    expect(configDifferences(null, production, 'preview')).toBeNull();
    // Run 39516902955: EAS serialises the export in another key order (ios: infoPlist first); order is not a difference.
    const reordered = { updates: { requestHeaders: { 'expo-channel-name': 'preview' }, url: 'u' }, runtimeVersion: { policy: 'appVersion' }, plugins: ['expo-router'], ios: { buildNumber: '60' }, version: '0.5.35', name: '竹科聖經' };
    expect(configDifferences(reordered, production, 'preview')).toEqual([]);
  });

  it('reads expo-updates rows and the screen text the flows end on', () => {
    expect(parseDbRows('01A15B89DBBD7910A611CD5D3E20D84D|1761001123773|1|1|0\n')).toEqual([{ id: hexId(UPDATE), commitTime: 1761001123773, status: 1, successfulLaunches: 1, failedLaunches: 0 }]);
    const tree = { attributes: { accessibilityText: '' }, children: [{ attributes: { text: '版本 0.5.35 (60) · 更新 20261021-20d84d', value: '' }, children: [] }, { attributes: { accessibilityText: '開啟帳戶' } }] };
    expect(hierarchyTexts(JSON.stringify(tree))).toEqual(['版本 0.5.35 (60) · 更新 20261021-20d84d', '開啟帳戶']);
    expect(hierarchyTexts('maestro: driver not running')).toBeNull();
  });

  it('reads every plist key the native check needs, also strings, numbers and booleans plutil will not write as JSON', () => {
    // As plutil answered on the macos-26 runner (run 39522793472): JSON only for a dictionary or an array.
    const info: Record<string, unknown> = {
      CFBundleIdentifier: 'org.qingmu.youth', CFBundleVersion: '60', CFBundleExecutable: 'app', EXUpdatesEnabled: true, EXUpdatesHasEmbeddedUpdate: false,
      EXUpdatesLaunchWaitMs: 0, EXUpdatesRequestHeaders: { 'expo-channel-name': 'preview' }, CFBundleURLTypes: [{ CFBundleURLSchemes: ['org.qingmu.youth'] }],
    };
    const extract = (key: string, format: 'json' | 'raw') => {
      if (!(key in info)) throw new Error(`Could not extract value, error: No value at that key path or invalid key path: ${key}`);
      const value = info[key];
      if (format === 'json') { if (typeof value !== 'object') throw new Error('Could not extract value: Invalid object in plist for destination format'); return JSON.stringify(value); }
      return `${String(value)}\n`;
    };
    expect(plistKey(extract, 'CFBundleIdentifier')).toEqual({ found: true, value: 'org.qingmu.youth' });
    expect(plistKey(extract, 'CFBundleVersion')).toEqual({ found: true, value: '60' });
    expect(plistKey(extract, 'CFBundleExecutable')).toEqual({ found: true, value: 'app' });
    expect(plistKey(extract, 'EXUpdatesEnabled')).toEqual({ found: true, value: true });
    expect(plistKey(extract, 'EXUpdatesHasEmbeddedUpdate')).toEqual({ found: true, value: false });
    expect(plistKey(extract, 'EXUpdatesLaunchWaitMs')).toEqual({ found: true, value: '0' });
    expect(plistKey(extract, 'EXUpdatesRequestHeaders')).toEqual({ found: true, value: { 'expo-channel-name': 'preview' } });
    expect(plistKey(extract, 'CFBundleURLTypes')).toEqual({ found: true, value: [{ CFBundleURLSchemes: ['org.qingmu.youth'] }] });
    expect(plistKey(extract, 'EXUpdatesURL')).toEqual({ found: false });
    // What the native check makes of the raw scalars: the store build's values pass, as they are compared.
    const evidence = passingEvidence();
    evidence.native = { ...evidence.native!, updates: { ...evidence.native!.updates, enabled: plistKey(extract, 'EXUpdatesEnabled').value, launchWaitMs: plistKey(extract, 'EXUpdatesLaunchWaitMs').value } };
    expect(statusOf(evidence).native).toBe('PASS');
  });

  it('opens the reader on the plan entry for the Taipei day (data/reading-plan-2026.json)', () => {
    expect(expectedReading('2026-10-21')).toEqual({ date: '2026-10-21', inPlan: true, label: 'YouVersion原生閱讀器：徒1、詩124、詩125', references: ['ACT.1', 'PSA.124', 'PSA.125'] });
  });
});

describe('iPhone OTA acceptance: verdict', () => {
  it('passes only when every check passes', () => {
    const result = judge(passingEvidence());
    expect(result.checks.map(check => `${check.id}:${check.status}`)).toEqual(['group:PASS', 'channel:PASS', 'native:PASS', 'embedded:PASS', 'isolation:PASS', 'download:PASS', 'running:PASS', 'health:PASS', 'reader:PASS']);
    expect(result).toMatchObject({ verdict: 'PASS', expectedUpdateId: UPDATE, observedUpdateIds: [hexId(UPDATE), '20261021-20d84d'] });
  });

  // The counter-proof run: a group that does not exist, while the app opens fine and runs the preview update.
  it('fails a group with no iOS update even though the app runs an update and opens', () => {
    const evidence = passingEvidence();
    evidence.resolve = { ...evidence.resolve!, groupId: 'cd676051-203b-4fda-8a55-a87d1bcf4a43', group: { ...evidence.resolve!.group, status: 404, updateId: null, updateGroup: null, createdAt: null, runtimeVersion: null }, expected: null };
    const result = judge(evidence);
    expect(result.verdict).toBe('FAIL');
    expect(statusOf(evidence)).toEqual({ group: 'FAIL', channel: 'FAIL', native: 'PASS', embedded: 'PASS', isolation: 'PASS', download: 'FAIL', running: 'FAIL', health: 'PASS', reader: 'PASS' });
    expect(result.observedUpdateIds).toContain(hexId(UPDATE));
  });

  it('compares update IDs: another iOS update of the same runtime fails download and running', () => {
    const evidence = passingEvidence();
    const other = '01a15c00-0000-7000-8000-0000001234ab';
    evidence.resolve = { ...evidence.resolve!, expected: { updateId: other, createdAt: '2026-10-21T01:00:00.000Z', runtimeVersion: '0.5.35', label: updateLabelSuffix(other, '2026-10-21T01:00:00.000Z') } };
    expect(statusOf(evidence)).toMatchObject({ channel: 'FAIL', download: 'FAIL', running: 'FAIL' });
  });

  it('fails when the second start ran the embedded copy (no update in the version line)', () => {
    const evidence = passingEvidence();
    evidence.accountTexts = ['版本 0.5.35 (60)'];
    evidence.launch2 = { measured: true, error: null, rows: [{ id: hexId(UPDATE), commitTime: 1, status: 1, successfulLaunches: 0, failedLaunches: 1 }] };
    expect(statusOf(evidence)).toMatchObject({ running: 'FAIL', health: 'FAIL' });
  });

  it('fails a version line from a simulator outside Taiwan time', () => {
    const evidence = passingEvidence();
    evidence.accountTexts = ['版本 0.5.35 (60) · 更新 20261020-20d84d'];
    expect(statusOf(evidence).running).toBe('FAIL');
  });

  it('fails unmeasured evidence instead of passing it', () => {
    const evidence = passingEvidence();
    evidence.end = { ...evidence.end!, crashReports: null };
    evidence.launch1 = null;
    evidence.readerTexts = null;
    expect(statusOf(evidence)).toMatchObject({ health: 'FAIL', download: 'FAIL', embedded: 'FAIL', reader: 'FAIL' });
  });

  it('fails ErrorRecovery, a crash report or a dead process', () => {
    for (const end of [{ errorRecoveryLines: ['ErrorRecovery: launching a cached update'] }, { crashReports: ['qingmuyouth-2026-10-21.ips'] }, { appRunning: false }, { expoErrorLog: true }]) {
      const evidence = passingEvidence();
      evidence.end = { ...evidence.end!, ...end };
      expect(statusOf(evidence).health).toBe('FAIL');
    }
  });

  it('fails a reader on another day or still preparing', () => {
    const evidence = passingEvidence();
    evidence.readerTexts = ['彼得後書 2，今日第1段，共3段', '彼得後書 3，今日第2段，共3段', '詩篇 123，今日第3段，共3段', 'YouVersion原生閱讀器：彼後2、彼後3、詩123'];
    expect(statusOf(evidence).reader).toBe('FAIL');
    const preparing = passingEvidence();
    preparing.readerTexts = [...preparing.readerTexts!, '官方閱讀器還在準備中，請稍後再試'];
    expect(statusOf(preparing).reader).toBe('FAIL');
  });

  it('fails a build on the wrong channel, commit or update policy', () => {
    for (const change of [{ updates: { channel: 'production' } }, { sourceCommit: '296248bbf87acdace25467275af604b93381a2c4' }, { updates: { checkOnLaunch: 'NEVER' } }, { configDifferences: ['plugins'] }]) {
      const evidence = passingEvidence();
      evidence.native = { ...evidence.native!, ...change, updates: { ...evidence.native!.updates, ...(change as { updates?: object }).updates } };
      expect(statusOf(evidence).native).toBe('FAIL');
    }
    const resigned = passingEvidence();
    resigned.native = { ...resigned.native!, embedded: { ...resigned.native!.embedded, commitTime: Date.parse('2026-10-21T07:00:00Z') } };
    expect(statusOf(resigned).embedded).toBe('FAIL');
  });
});

describe('iPhone OTA acceptance: the update never reaches the real backend', () => {
  it('fails when the update names another API host, the redirect did not answer, or the app never used it', () => {
    for (const change of [{ apiHost: { host: 'api.example.test', filesWithHost: 0, filesScanned: 30 } }, { redirectAnswered: false }, { apiRequests: 0 }, { apiRequests: null }]) {
      const evidence = passingEvidence();
      evidence.isolation = { ...evidence.isolation!, ...change };
      expect(statusOf(evidence).isolation).toBe('FAIL');
    }
  });
});

describe('iPhone OTA acceptance: what the workflow may do', () => {
  const workflow = readFileSync('.github/workflows/ios-ota-verify.yml', 'utf8');
  const scripts = ['scripts/ios/ota-verify.ts', 'scripts/ios/ota-sim-run.sh'].map(path => readFileSync(path, 'utf8')).join('\n');

  it('runs only when started by hand', () => {
    expect(Object.keys(parse(workflow).on)).toEqual(['workflow_dispatch']);
  });

  it('never publishes, republishes or switches a channel, and uses no secret', () => {
    for (const source of [workflow, scripts]) {
      expect(source).not.toMatch(/eas-cli|eas update|update:(republish|rollback)|channel:(create|edit|rollout)|secrets\./);
      expect(source).not.toMatch(/QINGMU_CI_DISABLE_OTA_CHECKS:|QINGMU_CI_DISABLE_OTA_CHECKS=1/);
    }
    expect(parse(workflow).permissions).toEqual({ contents: 'read' });
  });

  it('keeps the real startup check on: the build follows a real channel with ON_ERROR_RECOVERY', () => {
    expect(parse(workflow).jobs.simulator.env.EAS_BUILD_PROFILE).toBe('${{ inputs.channel }}');
    expect(parse(workflow).on.workflow_dispatch.inputs.channel.options).toEqual(['preview', 'production']);
  });

  it('flows only read: no restart, no reinstall, nothing that signs in, out or writes', () => {
    const dir = new URL('../../.maestro/ios-ota/', import.meta.url);
    const flows = readdirSync(dir).filter(name => name.endsWith('.yaml'));
    expect(flows.sort()).toEqual(['1-reader-today.yaml', '2-account-version.yaml']);
    const taps: string[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'tapOn') taps.push(typeof inner === 'string' ? inner : String((inner as { text?: unknown; id?: unknown }).text ?? (inner as { id?: unknown }).id));
        visit(inner);
      }
    };
    for (const name of flows) {
      const commands = parseAllDocuments(readFileSync(new URL(name, dir), 'utf8'))[1].toJSON();
      expect(JSON.stringify(commands), name).not.toMatch(/launchApp|clearState|stopApp|inputText|eraseText|swipe|pressKey/);
      visit(commands);
    }
    expect([...new Set(taps)].sort()).toEqual(['積分', '開啟帳戶'].sort());
  });

  it('starts the update signed in only through the synthetic fixture session, against the local backend', () => {
    const seed = readFileSync('scripts/ios/ota-seed-entry.js', 'utf8');
    expect(seed).toContain("memberId: 'fixture:self'");
    expect(seed).toMatch(/EXPO_PUBLIC_QINGMU_FIXTURE === 'true'/);
    const run = readFileSync('scripts/ios/ota-sim-run.sh', 'utf8');
    // The API host name points at loopback for both address families before the update starts.
    expect(run).toMatch(/printf '127\.0\.0\.1 %s\\n::1 %s\\n' "\$API_HOST" "\$API_HOST" \| sudo tee -a \/etc\/hosts/);
    expect(run.indexOf('/etc/hosts')).toBeLessThan(run.indexOf('cold_start 1'));
    expect(parse(workflow).jobs.simulator.env.EXPO_PUBLIC_QINGMU_API_BASE_URL).toBe('https://127.0.0.1:8788');
  });
});
