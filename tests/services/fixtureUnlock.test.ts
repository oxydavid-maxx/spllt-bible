import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ authenticateAsync: vi.fn(async () => ({ success: false })) }));
vi.mock('expo-local-authentication', () => auth);

import { createNativeAdminAuthenticator, fixtureUnlockRequested } from '../../src/services/adminUnlockGuard';

// The CI simulator has no Face ID or passcode; only a fixture build may be told to skip the device unlock, and only
// by the launch argument the 全體 flow passes. A real build always asks the device.
describe('the fixture-only unlock', () => {
  it('a real build ignores the launch argument and never reads it', () => {
    const read = vi.fn(() => 'yes');
    expect(fixtureUnlockRequested(false, read)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('a fixture build unlocks only on exactly "yes"', () => {
    expect(fixtureUnlockRequested(true, () => 'yes')).toBe(true);
    for (const value of [undefined, null, 'true', 1, 'YES']) expect(fixtureUnlockRequested(true, () => value)).toBe(false);
    expect(fixtureUnlockRequested(true, () => { throw new Error('no settings'); })).toBe(false);
  });

  it('only the version-log flow asks for it, with the argument the app reads', () => {
    expect(readFileSync('src/services/adminUnlockGuard.ts', 'utf8')).toContain("Settings.get('qingmuFixtureUnlock')");
    const flows = readdirSync('.maestro/ios').filter((name) => readFileSync(`.maestro/ios/${name}`, 'utf8').includes('qingmuFixtureUnlock'));
    expect(flows).toEqual(['42-version-log.yaml']);
  });

  it('the device unlock still runs in a real build', async () => {
    expect(process.env.EXPO_PUBLIC_QINGMU_FIXTURE).not.toBe('true');
    expect(await createNativeAdminAuthenticator()()).toBe(false);
    expect(auth.authenticateAsync).toHaveBeenCalledOnce();
  });
});
