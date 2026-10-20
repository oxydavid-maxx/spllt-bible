// scripts/ota/ota-update.ts — one platform's preview OTA: export → gate → (only with --publish) eas update.
// usage: tsx scripts/ota/ota-update.ts --platform android|ios --message "<說明>" [--publish] [--local-env]
//
// `eas update` bundles and uploads in one step, so nothing could inspect the bytecode in between (2026-10-20 the
// first preview OTA shipped "2026-10-07…" for "2026-10-06" and crashed on launch, expo/expo#49626). Here the export
// runs first into dist/ota-<platform>, scripts/ota/verify-ota-bundle.ts checks it, and only a PASS reaches
// `eas update --skip-bundler` with that same folder. Publishing is preview only; production takes the accepted
// group with `update:republish` (docs/eas-update.md).
//
// The export reproduces what `eas update --environment production` runs itself (eas-cli 24.13.0 publish.js and
// update/index.js): the EAS "production" variables through `eas env:exec`, EXPO_NO_DOTENV=1, --clear, and
// --dump-sourcemap --dump-assetmap. One --platform per run: eas-cli cannot see this project's nested @expo/cli,
// so its own `--platform all` export also bundles web, which fails on expo-sqlite's web wasm.
// --local-env skips the EAS variables (local proof exports only; never publish one).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PLAN, formatGateTable, type OtaPlatform, verifyOtaExport } from './verify-ota-bundle';

export const EAS_CLI = 'eas-cli@24.13.0';

export interface OtaUpdateOptions { platform: OtaPlatform; message: string; publish: boolean; localEnv: boolean }
export type Runner = (command: string[], env: NodeJS.ProcessEnv) => number;

export const outputDir = (platform: OtaPlatform) => `dist/ota-${platform}`;

export function exportCommand(platform: OtaPlatform): string[] {
  return ['npx', 'expo', 'export', '--platform', platform, '--output-dir', outputDir(platform), '--dump-sourcemap', '--dump-assetmap', '--clear'];
}

export function publishCommand(options: OtaUpdateOptions): string[] {
  return ['npx', EAS_CLI, 'update', '--skip-bundler', '--input-dir', outputDir(options.platform), '--platform', options.platform,
    '--channel', 'preview', '--environment', 'production', '--message', options.message, '--non-interactive', '--json'];
}

/** The shell (cmd.exe or sh) gets one line: quote anything that is not a plain token. parseArgs keeps " % $ ` out of messages. */
export function shellLine(command: string[]): string {
  return command.map((arg) => (/^[\w@./:=,+-]+$/.test(arg) ? arg : `"${arg}"`)).join(' ');
}

const defaultRunner: Runner = (command, env) => {
  const run = spawnSync(shellLine(command), { shell: true, stdio: 'inherit', env });
  return run.status ?? 1;
};

export function runOtaUpdate(root: string, options: OtaUpdateOptions, run: Runner = defaultRunner, log: (line: string) => void = console.log): number {
  const dir = join(root, outputDir(options.platform));
  rmSync(dir, { recursive: true, force: true });
  const env = { ...process.env, EXPO_NO_DOTENV: '1' };
  const exportLine = exportCommand(options.platform);
  const exported = options.localEnv
    ? run(exportLine, env)
    : run(['npx', EAS_CLI, 'env:exec', 'production', shellLine(exportLine), '--non-interactive'], env);
  if (exported !== 0 || !existsSync(join(dir, 'metadata.json'))) {
    log(`匯出失敗 (exit ${exported})：沒有推。`);
    return 1;
  }
  const plan = JSON.parse(readFileSync(join(root, DEFAULT_PLAN), 'utf8'));
  const checks = verifyOtaExport(dir, { platforms: [options.platform], plan });
  log(formatGateTable(checks));
  if (!checks.every((check) => check.ok)) return 1;
  if (options.localEnv) {
    log('--local-env 的匯出沒有 EAS production 變數，只能驗證，不能推。');
    return 0;
  }
  if (!options.publish) {
    log(`檢查通過。要推 preview 就加 --publish 重跑，或直接執行：\n${shellLine(publishCommand(options))}`);
    return 0;
  }
  return run(publishCommand(options), env);
}

export function parseArgs(argv: string[]): OtaUpdateOptions | string {
  const value = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const platform = value('--platform');
  const message = value('--message')?.trim();
  if (platform !== 'android' && platform !== 'ios') return '--platform 只能是 android 或 ios (兩個平台分開推)';
  if (!message) return '--message 必填';
  if (/["%$`\r\n]/.test(message)) return '--message 不可含 " % $ ` 或換行';
  return { platform, message, publish: argv.includes('--publish'), localEnv: argv.includes('--local-env') };
}

function main(argv: string[]): number {
  const options = parseArgs(argv);
  if (typeof options === 'string') {
    console.error(`${options}\nusage: tsx scripts/ota/ota-update.ts --platform android|ios --message "<說明>" [--publish] [--local-env]`);
    return 2;
  }
  if (options.publish && options.localEnv) {
    console.error('--local-env 的匯出不能推');
    return 2;
  }
  return runOtaUpdate(process.cwd(), options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
