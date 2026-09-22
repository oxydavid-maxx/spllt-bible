import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repo = process.cwd(), roots: string[] = [];
const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const privateTestKey = 'synthetic-private-process-binding';
const scalarForbidden = ['EXPO_PUBLIC_QINGMU_DEV_TOKEN', 'EXPO_PUBLIC_QINGMU_TEST_DATE', 'EXPO_PUBLIC_QINGMU_QA_AUDIO_URI', 'EXPO_PUBLIC_QINGMU_AUDIO_URI'];
const booleanForbidden = ['EXPO_PUBLIC_QINGMU_FIXTURE', 'EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO'];
function put(root: string, path: string, content: string) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
function fixture(native = false) {
  const root = mkdtempSync(join(tmpdir(), 'qingmu-release-env-')); roots.push(root); mkdirSync(join(root, 'scripts'));
  for (const name of ['build-android.ps1', 'release-environment.ps1', 'build-boundary.ps1', 'build-dom-boundary.ps1', 'google-services-boundary.ps1']) {
    if (existsSync(join(repo, 'scripts', name))) copyFileSync(join(repo, 'scripts', name), join(root, 'scripts', name));
  }
  put(root, 'src/read-env.ts', 'export const enabled = process.env.EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE;\n');
  const env = { ...process.env };
  // Let Windows PowerShell load its own built-ins, not the parent PowerShell 7 module directory.
  delete env.PSModulePath;
  for (const key of Object.keys(env)) if (/^(EXPO_|QINGMU_|ANDROID_|JAVA_HOME$|GRADLE_)/.test(key)) delete env[key];
  Object.assign(env, {
    EXPO_PUBLIC_YOUVERSION_APP_KEY: privateTestKey, EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE: 'true',
    EXPO_PUBLIC_QINGMU_API_BASE_URL: 'https://example.invalid/api', QINGMU_YOUVERSION_ENV_FILE: join(root, 'private.env'),
    QINGMU_ANDROID_TOOL_ROOT: join(root, 'toolchain'), QINGMU_GRADLE_USER_HOME: join(root, 'cache'),
  });
  if (native) {
    mkdirSync(join(root, 'jdk')); mkdirSync(join(root, 'sdk'));
    Object.assign(env, { JAVA_HOME: join(root, 'jdk'), ANDROID_SDK_ROOT: join(root, 'sdk'), QINGMU_RELEASE_SIGNING_PROPERTIES: join(root, 'signing.properties') });
    put(root, 'signing.properties', '# synthetic fixture; no key\n');
    put(root, 'app.json', JSON.stringify({ expo: { version: '0.0.0', android: { versionCode: 1 } } }));
    put(root, 'android/app/build.gradle', 'versionName "0.0.0"\nversionCode 1\n');
    put(root, 'android/gradle.properties', 'hermesEnabled=false\n');
    put(root, 'android/app/build/generated/assets/react/release/www.bundle/sentinel.js', 'keep until preflight passes');
    put(root, 'android/app/build/outputs/apk/release/app-release.apk', 'not an APK: no Gradle build occurs in this test');
    put(root, 'android/gradlew.bat', `@echo off\r\necho %* > "%~dp0arguments.txt"\r\n"${process.execPath}" "%~dp0probe.cjs" > "%~dp0environment.json"\r\nexit /b %errorlevel%\r\n`);
    put(root, 'android/probe.cjs', `const expo = require(${JSON.stringify(require.resolve('@expo/env'))}); expo.loadProjectEnv(${JSON.stringify(root)}, {mode:'production', force:true, silent:true}); console.log(JSON.stringify({dotenv:process.env.EXPO_NO_DOTENV, forbiddenPresent:Boolean(process.env.EXPO_PUBLIC_QINGMU_DEV_TOKEN), unknownPresent:Boolean(process.env.EXPO_PUBLIC_QINGMU_FROM_DOTENV), privateKeyPreserved:process.env.EXPO_PUBLIC_YOUVERSION_APP_KEY===${JSON.stringify(privateTestKey)}}));`);
  }
  return { root, env };
}
function run(f: ReturnType<typeof fixture>, changes: Record<string, string | undefined> = {}, flags = '', variant = 'release') {
  const env = { ...f.env, ...changes };
  const command = `$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1'); try { & ${quote(join(f.root, 'scripts/build-android.ps1'))} -Variant ${variant} ${flags} } catch { [pscustomobject]@{message=$_.Exception.Message; noDotenv=$env:EXPO_NO_DOTENV; keyPresent=[bool]$env:EXPO_PUBLIC_YOUVERSION_APP_KEY} | ConvertTo-Json -Compress; exit 17 }`;
  const result = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', env, timeout: 20_000 });
  if (result.error) throw result.error;
  return { status: result.status, text: result.stdout + result.stderr, body: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}
function files(root: string): string[] { return readdirSync(root, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? files(join(root, item.name)) : [join(root, item.name)]).sort(); }
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('qingmu-release-env-')) throw new Error('Unsafe fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

describe('official Android release entry environment guard', () => {
  it.each(scalarForbidden.flatMap((name) => ['synthetic-sensitive-value', 'false', ' '].map((value) => ({ name, value }))))('rejects nonempty $name before native prerequisites without exposing the value', ({ name, value }) => {
    const f = fixture(), before = files(f.root); const result = run(f, { [name]: value });
    expect(result.status).toBe(17); expect(result.body.message).toContain(name); expect(result.body.message).not.toContain('native project');
    expect(result.text).not.toContain('synthetic-sensitive-value'); expect(files(f.root)).toEqual(before);
  });

  it.each(booleanForbidden.flatMap((name) => ['true', 'FALSE', '0'].map((value) => ({ name, value }))))('requires exact false or unset for boolean $name ($value)', ({ name, value }) => {
    const result = run(fixture(), { [name]: value });
    expect(result.status).toBe(17); expect(result.body.message).toContain(name);
  });

  it.each([undefined, 'false'])('allows both disabled boolean flags as %s', (value) => {
    const result = run(fixture(), Object.fromEntries(booleanForbidden.map((name) => [name, value])));
    expect(result.body.message).toContain('Android native project is missing'); expect(result.body.noDotenv).toBe('1');
  });

  it.each(['TRUE', 'True', ' true ', 'false'])('requires case-sensitive exact text probe true (%s)', (value) => {
    const result = run(fixture(), { EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE: value });
    expect(result.body.message).toContain('EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE'); expect(result.body.message).not.toContain('native project');
  });

  it.each(['EXPO_PUBLIC_YOUVERSION_APP_KEY', 'EXPO_PUBLIC_QINGMU_API_BASE_URL', 'EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE'])('rejects whitespace-only required %s', (name) => {
    const result = run(fixture(), { [name]: '   ' }); expect(result.body.message).toContain(name);
  });

  it('finds newly introduced app environment variables before native prerequisites', () => {
    const f = fixture(); put(f.root, 'src/new-env.ts', 'export const value = process.env.EXPO_PUBLIC_NEW_UNCLASSIFIED;');
    expect(run(f).body.message).toContain('EXPO_PUBLIC_NEW_UNCLASSIFIED');
  });

  it('still classifies every environment input in the actual application source', () => {
    const f = fixture();
    const command = `$ErrorActionPreference='Stop'; . ${quote(join(repo, 'scripts/release-environment.ps1'))}; Assert-QingmuReleaseEnvironment -ProjectRoot ${quote(repo)}; Write-Output 'SOURCE_CLASSIFICATION_PASS'`;
    const result = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', env: f.env, timeout: 20_000 });
    expect(result.status, result.stderr).toBe(0); expect(result.stdout.trim()).toBe('SOURCE_CLASSIFICATION_PASS');
  });

  it('loads the private key into the process before checking required release values', () => {
    const f = fixture(); put(f.root, 'private.env', `EXPO_PUBLIC_YOUVERSION_APP_KEY=${privateTestKey}\n`);
    const result = run(f, { EXPO_PUBLIC_YOUVERSION_APP_KEY: undefined });
    expect(result.body.message).toContain('Android native project is missing'); expect(result.body.keyPresent).toBe(true); expect(result.text).not.toContain(privateTestKey);
  });

  it('does not rewrite native properties or clear DOM assets when release environment validation fails', () => {
    const f = fixture(true), sentinel = join(f.root, 'android/app/build/generated/assets/react/release/www.bundle/sentinel.js');
    const result = run(f, { EXPO_PUBLIC_QINGMU_DEV_TOKEN: 'false' });
    expect(result.status).toBe(17); expect(result.body.message).toContain('EXPO_PUBLIC_QINGMU_DEV_TOKEN');
    expect(readFileSync(join(f.root, 'android/gradle.properties'), 'utf8')).toBe('hermesEnabled=false\n');
    expect(readFileSync(sentinel, 'utf8')).toBe('keep until preflight passes'); expect(existsSync(join(f.root, 'android/arguments.txt'))).toBe(false);
  });

  it('leaves debug environment behavior unchanged', () => {
    const result = run(fixture(), { EXPO_PUBLIC_QINGMU_DEV_TOKEN: 'synthetic-sensitive-value', EXPO_NO_DOTENV: '0' }, '', 'debug');
    expect(result.body.message).toContain('Android native project is missing'); expect(result.body.noDotenv).toBe('0');
  });

  it.each([false, true])('records the actual Minify switch/arguments and prevents Expo dotenv contamination (minify=%s)', (minify) => {
    const f = fixture(true); put(f.root, '.env.production', 'EXPO_PUBLIC_QINGMU_DEV_TOKEN=dotenv-injected\nEXPO_PUBLIC_QINGMU_FROM_DOTENV=true\n');
    put(f.root, 'private.env', `EXPO_PUBLIC_YOUVERSION_APP_KEY=${privateTestKey}\n`);
    const result = run(f, { EXPO_PUBLIC_YOUVERSION_APP_KEY: undefined, EXPO_NO_DOTENV: '0' }, minify ? '-Minify' : '');
    expect(result.status).toBe(0); expect(result.body.minify).toBe(minify);
    const actual = readFileSync(join(f.root, 'android/arguments.txt'), 'utf8');
    for (const flag of ['-Pandroid.enableMinifyInReleaseBuilds=true', '-Pandroid.enableShrinkResourcesInReleaseBuilds=true']) {
      expect(actual.includes(flag)).toBe(minify); expect(result.body.command.includes(flag)).toBe(minify); expect(result.body.gradleArguments.includes(flag)).toBe(minify);
    }
    expect(JSON.parse(readFileSync(join(f.root, 'android/environment.json'), 'utf8'))).toEqual({ dotenv: '1', forbiddenPresent: false, unknownPresent: false, privateKeyPreserved: true });
    expect(result.text).not.toContain(privateTestKey);
  }, 30_000);

  it('keeps non-ASCII build scripts runnable by Windows PowerShell 5.1', () => {
    for (const name of ['build-android.ps1', 'release-environment.ps1']) {
      const path = join(repo, 'scripts', name); if (!existsSync(path)) continue;
      const bytes = readFileSync(path); if (bytes.some((byte) => byte > 0x7f)) expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    }
  });
});
