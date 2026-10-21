import * as InAppUpdates from 'expo-in-app-updates';
import { runtimeConfig } from '../config/runtime';
import { detectIosInstallSource, type IosInstallSource } from './iosInstallSource';
import { fetchTestflightUpdateState, fetchUpdateState, NO_UPDATE, TESTFLIGHT_WEB_URL, VERSION_URL, type UpdateState } from './updateCheck';

/**
 * Which update to offer, and what 更新 does.
 *
 * 光佑 (2026-10-13): Play took hours to update his phone on its own, so the app now asks Play itself
 * and 更新 runs Play's in-app update (the official Play Core flow, through expo-in-app-updates), behind
 * the same prompt, notice-board card and reader line as before. A build installed some other way — a
 * sideloaded APK from the install page — keeps the published version file and its install page.
 *
 * 光佑 (2026-10-21): the iPhones are installed from TestFlight, whose automatic updates each tester has to
 * switch on; the pastor never did and stayed behind. A TestFlight iPhone now reads the version file's `ios`
 * block and 更新 opens 竹科聖經 in TestFlight (src/services/iosInstallSource.ts tells it apart). An App Store
 * install, a simulator or a development build asks nobody and is never shown a TestFlight link.
 *
 * Kept apart from updateCheck.ts on purpose: that module must load in the Node release scripts, and
 * this one pulls in a native module.
 */
export const PLAY_LISTING_URL = 'https://play.google.com/store/apps/details?id=org.qingmu.youth';

interface PlayAnswer { updateAvailable: boolean }

/**
 * The published version file, or in a fixture build (CI, the simulator flows) the fixture backend's copy one
 * build ahead of the app under test (server/fixtureVersionNotice.ts): the flows never read the real file.
 */
export function versionFileUrl(): string {
  if (process.env.EXPO_PUBLIC_QINGMU_FIXTURE !== 'true') return VERSION_URL;
  return `${runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl}/api/fixture/app-version.json`;
}

/**
 * Play answers for the installs it manages, including which test track this account is on. When it
 * does not manage this install it fails (Play Core install error -10, "app not owned"), and so does
 * a phone without Play; only then is the published version file asked.
 */
export async function checkAppUpdate(
  installedVersionCode: number | null,
  platform: string,
  {
    play = (): Promise<PlayAnswer> => InAppUpdates.checkForUpdate(),
    manifest = (installed: number | null, os: string) => fetchUpdateState(installed, os, fetch, versionFileUrl()),
    iosSource = () => detectIosInstallSource(),
    testflight = (installed: number | null, receiptProvesTestflight: boolean) => fetchTestflightUpdateState(installed, { receiptProvesTestflight, url: versionFileUrl() }),
  }: {
    play?: () => Promise<PlayAnswer>;
    manifest?: (installed: number | null, platform: string) => Promise<UpdateState>;
    iosSource?: () => Promise<IosInstallSource>;
    testflight?: (installed: number | null, receiptProvesTestflight: boolean) => Promise<UpdateState>;
  } = {},
): Promise<UpdateState> {
  if (platform === 'ios') {
    // On iOS the build number is the Android versionCode (app.config.js), so installedVersionCode compares as is.
    let source: IosInstallSource;
    try { source = await iosSource(); } catch { return NO_UPDATE; }
    if (source === 'testflight') return testflight(installedVersionCode, true);
    if (source === 'store-unknown') return testflight(installedVersionCode, false);
    // App Store, simulator, development: no request, no prompt, never a TestFlight link.
    return NO_UPDATE;
  }
  if (platform !== 'android') return NO_UPDATE;
  let answer: PlayAnswer;
  try {
    answer = await play();
  } catch {
    return manifest(installedVersionCode, platform);
  }
  // Play answered, so Play owns this install. "Nothing newer" is final: the sideload APK is signed
  // differently and would not even install over a Play build.
  if (!answer.updateAvailable) return NO_UPDATE;
  // Play reports only the versionCode, not the name members know, so the prompt shows no number.
  return { available: true, mandatory: false, versionName: null, url: PLAY_LISTING_URL, note: null, viaPlay: true };
}

/**
 * 更新. A Play update runs inside the app (Play's full-screen immediate flow); when Play cannot start
 * it, the Play listing opens instead, where the 更新 button is always one tap away. A sideloaded
 * build opens its install page at once, exactly as before. A TestFlight iPhone opens TestFlight, or its
 * web page when the TestFlight app cannot be opened.
 */
export function startAppUpdate(
  state: UpdateState,
  open: (url: string) => void | Promise<unknown>,
  start: () => Promise<boolean> = () => InAppUpdates.startUpdate(true),
): Promise<void> {
  const url = state.url;
  if (!url) return Promise.resolve();
  if (state.viaTestflight) {
    return attempt(() => open(url)).then(() => undefined, () => { void attempt(() => open(TESTFLIGHT_WEB_URL)).catch(() => undefined); });
  }
  if (!state.viaPlay) {
    void attempt(() => open(url)).catch(() => undefined);
    return Promise.resolve();
  }
  return start().then((started) => { if (!started) void attempt(() => open(url)).catch(() => undefined); }, () => { void attempt(() => open(url)).catch(() => undefined); });
}

/** Runs `open` now (callers check it synchronously) and turns a throw or a rejected promise into one rejection. */
function attempt(run: () => void | Promise<unknown>): Promise<unknown> {
  try { return Promise.resolve(run()); } catch (error) { return Promise.reject(error); }
}
