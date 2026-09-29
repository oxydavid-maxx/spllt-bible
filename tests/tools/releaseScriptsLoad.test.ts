import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// The release check runs under Node (tsx), not Metro. When a module it imports pulled in react-native,
// Node could not parse react-native's Flow source and the check died before running (0.5.21 release).
describe('release scripts load under Node', () => {
  it('verify-install-link gets as far as its own usage check', () => {
    const run = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-install-link.ts'], { encoding: 'utf8', timeout: 60_000 });
    expect(run.stderr).not.toContain('TransformError');
    expect(run.stderr).toContain('usage: tsx scripts/verify-install-link.ts');
  }, 90_000);
});
