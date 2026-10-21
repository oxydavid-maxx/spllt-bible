import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { checkAppUpdate, startAppUpdate } from '../../src/services/appUpdate';
import {
  compareTestflight, fetchTestflightUpdateState, NO_UPDATE, readPublishedIos, readPublishedVersion,
  TESTFLIGHT_APP_URL, TESTFLIGHT_WEB_URL, type UpdateState,
} from '../../src/services/updateCheck';

// 光佑 (2026-10-21): the iPhones come from TestFlight, whose automatic updates each tester has to switch on
// themselves; the pastor never did and stayed behind. So a TestFlight iPhone now gets the same 有新版本 as
// Android, and 更新 opens 竹科聖經 in TestFlight. An App Store install must never be shown a TestFlight link.
const PAGE = 'https://home.luminexhealthbiohack.com/public/jhuke-bible/';
const FILE = {
  versionCode: 61, versionName: '0.5.36', url: PAGE, mandatory: false, note: 'Android 的說明',
  ios: { testflight: { buildNumber: 61, versionName: '0.5.36', note: '朗讀更穩定。' } },
};
const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe('the iOS block of the version file', () => {
  it('reads the newest TestFlight build', () => {
    expect(readPublishedIos(FILE)).toEqual({ testflight: { buildNumber: 61, versionName: '0.5.36', mandatory: false, note: '朗讀更穩定。' }, appStoreListed: false });
  });

  it('reads nothing from a missing or malformed block', () => {
    for (const ios of [undefined, null, 'x', { testflight: { buildNumber: '61', versionName: '0.5.36' } }, { testflight: { buildNumber: 61, versionName: ' ' } }, { testflight: { buildNumber: 0, versionName: '0.5.36' } }]) {
      expect(readPublishedIos({ ...FILE, ios }).testflight).toBeNull();
    }
  });

  it('notes when the app is also on the App Store', () => {
    expect(readPublishedIos({ ...FILE, ios: { ...FILE.ios, appStore: { buildNumber: 60 } } }).appStoreListed).toBe(true);
  });

  it('leaves what older Android apps read exactly as it was', () => {
    const { ios: _ios, ...android } = FILE;
    expect(readPublishedVersion(FILE)).toEqual(readPublishedVersion(android));
  });
});

describe('comparing against the TestFlight build that is running', () => {
  it('offers a newer build, pointing at TestFlight', () => {
    expect(compareTestflight(readPublishedIos(FILE).testflight, 60)).toEqual({
      available: true, mandatory: false, versionName: '0.5.36', url: TESTFLIGHT_APP_URL, note: '朗讀更穩定。', viaTestflight: true,
    });
  });

  it('says nothing for the same or an older build, or an unreadable one', () => {
    const published = readPublishedIos(FILE).testflight;
    expect(compareTestflight(published, 61)).toEqual(NO_UPDATE);
    expect(compareTestflight(published, 62)).toEqual(NO_UPDATE);
    expect(compareTestflight(published, null)).toEqual(NO_UPDATE);
    expect(compareTestflight(null, 60)).toEqual(NO_UPDATE);
  });

  it('asks the given file and stays quiet on any failure', async () => {
    const fetchImpl = respond(FILE);
    expect((await fetchTestflightUpdateState(60, { receiptProvesTestflight: true, url: 'https://example.test/v.json', fetchImpl })).available).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/v.json', expect.anything());
    expect(await fetchTestflightUpdateState(60, { receiptProvesTestflight: true, fetchImpl: respond(FILE, false) })).toEqual(NO_UPDATE);
    expect(await fetchTestflightUpdateState(60, { receiptProvesTestflight: true, fetchImpl: vi.fn(async () => { throw new Error('offline'); }) })).toEqual(NO_UPDATE);
  });

  it('when only the release type says "store", keeps quiet once the app is also on the App Store', async () => {
    expect((await fetchTestflightUpdateState(60, { receiptProvesTestflight: false, fetchImpl: respond(FILE) })).available).toBe(true);
    const listed = { ...FILE, ios: { ...FILE.ios, appStore: { buildNumber: 61 } } };
    expect(await fetchTestflightUpdateState(60, { receiptProvesTestflight: false, fetchImpl: respond(listed) })).toEqual(NO_UPDATE);
    expect((await fetchTestflightUpdateState(60, { receiptProvesTestflight: true, fetchImpl: respond(listed) })).available).toBe(true);
  });
});

describe('which iPhones ask', () => {
  const play = vi.fn(async () => ({ updateAvailable: true }));
  const manifest = vi.fn(async () => NO_UPDATE);

  it('a TestFlight iPhone asks the version file and offers TestFlight', async () => {
    const testflight = vi.fn(async () => compareTestflight(readPublishedIos(FILE).testflight, 60));
    const state = await checkAppUpdate(60, 'ios', { play, manifest, iosSource: async () => 'testflight', testflight });
    expect(state).toMatchObject({ available: true, url: TESTFLIGHT_APP_URL, viaTestflight: true });
    expect(testflight).toHaveBeenCalledWith(60, true);
    expect(play).not.toHaveBeenCalled(); expect(manifest).not.toHaveBeenCalled();
  });

  it('an iPhone with no receipt but a store signature asks too, without the receipt proof', async () => {
    const testflight = vi.fn(async () => NO_UPDATE);
    await checkAppUpdate(60, 'ios', { play, manifest, iosSource: async () => 'store-unknown', testflight });
    expect(testflight).toHaveBeenCalledWith(60, false);
  });

  it('an App Store iPhone, a simulator or a development build asks nobody and never sees TestFlight', async () => {
    for (const source of ['app-store', 'other'] as const) {
      const testflight = vi.fn(async () => compareTestflight(readPublishedIos(FILE).testflight, 60));
      expect(await checkAppUpdate(60, 'ios', { play, manifest, iosSource: async () => source, testflight })).toEqual(NO_UPDATE);
      expect(testflight).not.toHaveBeenCalled();
    }
    expect(play).not.toHaveBeenCalled(); expect(manifest).not.toHaveBeenCalled();
  });

  it('an iPhone whose source cannot be read asks nobody', async () => {
    const testflight = vi.fn(async () => NO_UPDATE);
    expect(await checkAppUpdate(60, 'ios', { iosSource: async () => { throw new Error('native'); }, testflight })).toEqual(NO_UPDATE);
    expect(testflight).not.toHaveBeenCalled();
  });
});

describe('what 更新 does on a TestFlight iPhone', () => {
  const TESTFLIGHT: UpdateState = { available: true, mandatory: false, versionName: '0.5.36', url: TESTFLIGHT_APP_URL, note: null, viaTestflight: true };

  it('opens 竹科聖經 in the TestFlight app', async () => {
    const open = vi.fn(async () => undefined);
    await startAppUpdate(TESTFLIGHT, open);
    expect(open.mock.calls).toEqual([[TESTFLIGHT_APP_URL]]);
  });

  it('falls back to the TestFlight web page when the TestFlight app cannot be opened', async () => {
    const open = vi.fn(async (url: string) => { if (url.startsWith('itms-beta:')) throw new Error('no handler'); });
    await startAppUpdate(TESTFLIGHT, open);
    expect(open.mock.calls).toEqual([[TESTFLIGHT_APP_URL], [TESTFLIGHT_WEB_URL]]);
  });

  it('both addresses name this app: the App Store Connect id the release submits to', () => {
    const appId = JSON.parse(readFileSync('eas.json', 'utf8')).submit.production.ios.ascAppId;
    expect(TESTFLIGHT_APP_URL).toBe(`itms-beta://beta.itunes.apple.com/v1/app/${appId}`);
    expect(TESTFLIGHT_WEB_URL).toBe(`https://beta.itunes.apple.com/v1/app/${appId}`);
  });
});
