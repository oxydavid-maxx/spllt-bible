import { describe, expect, it, vi } from 'vitest';

import { checkAppUpdate, PLAY_LISTING_URL, startAppUpdate } from '../../src/services/appUpdate';
import { NO_UPDATE, type UpdateState } from '../../src/services/updateCheck';

// 光佑 (2026-10-13): Play took hours to update his phone on its own, so the app asks Play itself and
// 更新 runs Play's in-app update, behind the same prompt, card and reader line as before.
const PAGE = 'https://home.luminexhealthbiohack.com/public/jhuke-bible/';
const SIDELOAD: UpdateState = { available: true, mandatory: false, versionName: '0.5.22', url: PAGE, note: null };

describe('where the update comes from', () => {
  it('asks nobody on iOS, which updates from the App Store and may not be pointed anywhere else', async () => {
    const play = vi.fn(async () => ({ updateAvailable: true }));
    const manifest = vi.fn(async () => SIDELOAD);
    expect(await checkAppUpdate(47, 'ios', { play, manifest })).toEqual(NO_UPDATE);
    expect(play).not.toHaveBeenCalled();
    expect(manifest).not.toHaveBeenCalled();
  });

  it('offers a Play update when Play has a newer build for this account', async () => {
    const manifest = vi.fn(async () => SIDELOAD);
    const state = await checkAppUpdate(47, 'android', { play: async () => ({ updateAvailable: true }), manifest });
    expect(state).toEqual({ available: true, mandatory: false, versionName: null, url: PLAY_LISTING_URL, note: null, viaPlay: true });
    expect(manifest).not.toHaveBeenCalled();
  });

  it('trusts Play when it says there is nothing newer, and never sends a Play install to the APK page', async () => {
    // A Play-installed app is signed by Play; the sideload APK would not even install over it.
    const manifest = vi.fn(async () => SIDELOAD);
    expect(await checkAppUpdate(47, 'android', { play: async () => ({ updateAvailable: false }), manifest })).toEqual(NO_UPDATE);
    expect(manifest).not.toHaveBeenCalled();
  });

  it('falls back to the published version file when Play does not manage this install', async () => {
    // A sideloaded APK: Play answers "app not owned" (Play Core install error -10) by failing.
    const manifest = vi.fn(async () => SIDELOAD);
    const play = async (): Promise<{ updateAvailable: boolean }> => { throw new Error('Install Error(-10)'); };
    expect(await checkAppUpdate(44, 'android', { play, manifest })).toEqual(SIDELOAD);
    expect(manifest).toHaveBeenCalledWith(44, 'android');
  });
});

describe('what 更新 does', () => {
  const PLAY: UpdateState = { available: true, mandatory: false, versionName: null, url: PLAY_LISTING_URL, note: null, viaPlay: true };

  it('runs the Play in-app update and opens nothing when it starts', async () => {
    const open = vi.fn();
    const start = vi.fn(async () => true);
    await startAppUpdate(PLAY, open, start);
    expect(start).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the Play listing when the in-app update cannot start', async () => {
    for (const start of [async () => false, async (): Promise<boolean> => { throw new Error('no activity'); }]) {
      const open = vi.fn();
      await startAppUpdate(PLAY, open, start);
      expect(open).toHaveBeenCalledWith(PLAY_LISTING_URL);
    }
  });

  it('opens the install page for a sideloaded build, right away, without asking Play', async () => {
    const open = vi.fn();
    const start = vi.fn(async () => true);
    void startAppUpdate(SIDELOAD, open, start);
    expect(open).toHaveBeenCalledWith(PAGE);
    expect(start).not.toHaveBeenCalled();
  });
});
