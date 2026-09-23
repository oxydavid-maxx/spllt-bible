import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it('routes only the patched Android camera module away from Expo prebuilt artifacts', () => {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('expo-modules-autolinking/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const cli = join(dirname(manifestPath), manifest.bin['expo-modules-autolinking']);
  const resolved = JSON.parse(execFileSync(process.execPath, [cli, 'resolve', '--platform', 'android', '--json'], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, windowsHide: true,
  }));
  expect(resolved.configuration?.buildFromSource).toEqual(['expo-camera']);
  const projects = resolved.modules.flatMap((module: { projects?: Array<{ name: string; publication?: unknown }> }) => module.projects ?? []);
  const selected = projects.filter((project: { name: string }) => resolved.configuration.buildFromSource.some((pattern: string) => new RegExp('^(?:' + pattern + ')$').test(project.name)));
  expect(selected.map((project: { name: string }) => project.name)).toEqual(['expo-camera']);
  const camera = JSON.parse(readFileSync(require.resolve('expo-camera/package.json'), 'utf8'));
  expect(existsSync(join(process.cwd(), 'patches', 'expo-camera+' + camera.version + '.patch'))).toBe(true);
}, 30_000);

