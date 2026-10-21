import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { detectIosInstallSource, type InstallSourceProbe } from '../../src/services/iosInstallSource';

// Where an iPhone install came from decides whether it may be shown a TestFlight link (光佑 2026-10-21: App
// Store installs never). No native module is added: the store's receipt file sits in the app's own container
// (StoreKit/receipt from the App Store, StoreKit/sandboxReceipt from TestFlight), and expo-application tells a
// store-signed build from a simulator, development or ad-hoc build.
const APP_STORE = 5, SIMULATOR = 1, DEVELOPMENT = 3, AD_HOC = 4, UNKNOWN = 0;
function probe(receipts: Partial<Record<'receipt' | 'sandboxReceipt', boolean>>, releaseType: number, extra: Partial<InstallSourceProbe> = {}): InstallSourceProbe {
  return { fixture: false, forced: () => undefined, receipt: async (name) => receipts[name] === true, releaseType: async () => releaseType, ...extra };
}

describe('telling TestFlight from the App Store', () => {
  it('an App Store receipt means the App Store, even beside an old TestFlight receipt', async () => {
    expect(await detectIosInstallSource(probe({ receipt: true }, APP_STORE))).toBe('app-store');
    expect(await detectIosInstallSource(probe({ receipt: true, sandboxReceipt: true }, APP_STORE))).toBe('app-store');
  });

  it('a TestFlight (sandbox) receipt alone means TestFlight', async () => {
    expect(await detectIosInstallSource(probe({ sandboxReceipt: true }, APP_STORE))).toBe('testflight');
  });

  it('a store-signed build without a receipt yet is unconfirmed, never called App Store or TestFlight', async () => {
    expect(await detectIosInstallSource(probe({}, APP_STORE))).toBe('store-unknown');
  });

  it('a simulator, development, ad-hoc or unreadable build is neither', async () => {
    for (const type of [SIMULATOR, DEVELOPMENT, AD_HOC, UNKNOWN]) expect(await detectIosInstallSource(probe({}, type))).toBe('other');
  });

  it('reads failures as the safe answer', async () => {
    expect(await detectIosInstallSource(probe({}, APP_STORE, { receipt: async () => { throw new Error('denied'); } }))).toBe('store-unknown');
    expect(await detectIosInstallSource(probe({}, APP_STORE, { releaseType: async () => { throw new Error('native'); } }))).toBe('other');
  });
});

describe('the CI simulator can be told what to pretend', () => {
  it('a fixture build follows the launch argument', async () => {
    expect(await detectIosInstallSource(probe({}, SIMULATOR, { fixture: true, forced: () => 'testflight' }))).toBe('testflight');
    expect(await detectIosInstallSource(probe({}, SIMULATOR, { fixture: true, forced: () => 'app-store' }))).toBe('app-store');
    expect(await detectIosInstallSource(probe({}, SIMULATOR, { fixture: true, forced: () => undefined }))).toBe('other');
  });

  it('the flows pass the argument the app reads', () => {
    expect(readFileSync('src/services/iosInstallSource.ts', 'utf8')).toContain("Settings.get('qingmuInstallSource')");
    const flow = readFileSync('.maestro/ios/42-testflight-update.yaml', 'utf8');
    expect(flow).toMatch(/qingmuInstallSource: testflight/);
    expect(flow).toMatch(/qingmuInstallSource: app-store/);
    expect(readFileSync('.maestro/ios/40-no-update-prompt.yaml', 'utf8')).not.toContain('qingmuInstallSource');
  });

  it('a real build ignores it', async () => {
    const forced = vi.fn(() => 'testflight');
    expect(await detectIosInstallSource(probe({ receipt: true }, APP_STORE, { fixture: false, forced }))).toBe('app-store');
    expect(forced).not.toHaveBeenCalled();
  });
});
