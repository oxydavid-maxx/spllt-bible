/**
 * Whether a newer build exists, decided from a small file published beside the APK.
 *
 * Since 2026-10-13 this serves only builds that Play does not manage (a sideloaded APK). A Play
 * install asks Play's in-app updates instead (src/services/appUpdate.ts); the paragraph below is
 * why this file came first, and its no-prebuild premise no longer holds: Expo modules autolink at
 * Gradle time (android/settings.gradle `useExpoModules()`), so a native module needs no hand edits.
 *
 * The native route is Play's in-app updates, which can force a full-screen update flow. It needs a
 * Play Core module, a native module needs a prebuild, and this project deliberately does not
 * prebuild — android/ is generated once and edited under guard, because a prebuild here has broken
 * the build system before. So this is the version that can ship today: a few hundred bytes of JSON
 * and a comparison, no native code and nothing that can fail at build time.
 *
 * It does not replace Play's own automatic updating, which needs no code at all and is what will
 * actually update most phones. It exists because Google does not promise that a test track updates
 * on the same schedule as production, and a youth group on an internal track should not be silently
 * three versions behind.
 *
 * No new credential and no new server: the file sits on the same public page as the APK.
 */

/**
 * Beside the APK and its install page on home.luminex, and published with them in one step. The
 * GitHub copy it replaces was left at 0.5.9 for six releases, and on 2026-09-26 GitHub was
 * unreachable from this machine's connection several times while home.luminex always answered.
 */
export const VERSION_URL = 'https://home.luminexhealthbiohack.com/public/jhuke-bible/assets/app-version.json';

/** What 0.5.4 to 0.5.15 read. Kept in step with VERSION_URL for as long as those builds are installed. */
export const LEGACY_VERSION_URL =
  'https://raw.githubusercontent.com/oxydavid-maxx/spllt-bible/main/announcements/app-version.json';

const TIMEOUT_MS = 8_000;

export interface PublishedVersion {
  /** Android versionCode of the newest build. The only field compared. */
  versionCode: number;
  /** Shown to the member, because 0.5.4 means something to them and 25 does not. */
  versionName: string;
  /** Where to get it: the Play listing once it exists, a direct link before that. */
  url: string;
  /** A build nobody should stay behind. The notice then cannot be dismissed. */
  mandatory?: boolean;
  /** One line about what changed. Optional; absent shows nothing rather than a placeholder. */
  note?: string;
}

export interface UpdateState {
  available: boolean;
  mandatory: boolean;
  versionName: string | null;
  url: string | null;
  note: string | null;
  /** Play manages this install, so 更新 runs Play's in-app update (src/services/appUpdate.ts). */
  viaPlay?: true;
  /** A TestFlight iPhone (光佑 2026-10-21): 更新 opens this app in TestFlight. Never set for an App Store install. */
  viaTestflight?: true;
}

/**
 * 竹科聖經 in the TestFlight app, then its web page when the app cannot be opened (the simulator has none).
 * The id is the App Store Connect app id the release submits to (eas.json submit.production.ios.ascAppId).
 */
export const TESTFLIGHT_APP_URL = 'itms-beta://beta.itunes.apple.com/v1/app/6822755754';
export const TESTFLIGHT_WEB_URL = 'https://beta.itunes.apple.com/v1/app/6822755754';

/** The newest TestFlight build, from the version file's `ios.testflight` block (docs/app-version.md). */
export interface PublishedTestflight {
  /** CFBundleVersion of that build: app.config.js sets it to the Android versionCode. The only field compared. */
  buildNumber: number;
  versionName: string;
  mandatory?: boolean;
  note?: string;
}

/**
 * The `ios` block, added 2026-10-21. Older apps read only the top-level Android fields and ignore it.
 * `appStore` present (any object) says the app is also on the App Store: then an iPhone that cannot prove it
 * came from TestFlight is never offered TestFlight.
 */
export function readPublishedIos(value: unknown): { testflight: PublishedTestflight | null; appStoreListed: boolean } {
  const ios = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).ios : null;
  if (typeof ios !== 'object' || ios === null) return { testflight: null, appStoreListed: false };
  const block = ios as Record<string, unknown>;
  const appStoreListed = typeof block.appStore === 'object' && block.appStore !== null;
  const record = typeof block.testflight === 'object' && block.testflight !== null ? block.testflight as Record<string, unknown> : null;
  const buildNumber = record?.buildNumber;
  const versionName = record?.versionName;
  if (!record || typeof buildNumber !== 'number' || !Number.isInteger(buildNumber) || buildNumber <= 0 || typeof versionName !== 'string' || !versionName.trim()) {
    return { testflight: null, appStoreListed };
  }
  return {
    testflight: {
      buildNumber, versionName: versionName.trim(), mandatory: record.mandatory === true,
      note: typeof record.note === 'string' && record.note.trim() ? record.note.trim() : undefined,
    },
    appStoreListed,
  };
}

/** A newer TestFlight build than the one running; same rule as Android: equal or older is not an update. */
export function compareTestflight(published: PublishedTestflight | null, installedBuild: number | null): UpdateState {
  if (!published || installedBuild === null || published.buildNumber <= installedBuild) return NO_UPDATE;
  return {
    available: true, mandatory: published.mandatory === true, versionName: published.versionName,
    url: TESTFLIGHT_APP_URL, note: published.note ?? null, viaTestflight: true,
  };
}

/**
 * Ask on a TestFlight iPhone (src/services/appUpdate.ts decides which iPhone that is). Every failure is "no
 * update", as on Android. `receiptProvesTestflight` false means only the store signature was seen (no receipt
 * yet): such a phone is offered TestFlight only while the file does not say the app is on the App Store.
 */
export async function fetchTestflightUpdateState(
  installedBuild: number | null,
  { receiptProvesTestflight, url = VERSION_URL, fetchImpl = fetch }: { receiptProvesTestflight: boolean; url?: string; fetchImpl?: typeof fetch },
): Promise<UpdateState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return NO_UPDATE;
    const ios = readPublishedIos(await response.json());
    if (ios.appStoreListed && !receiptProvesTestflight) return NO_UPDATE;
    return compareTestflight(ios.testflight, installedBuild);
  } catch {
    return NO_UPDATE;
  } finally {
    clearTimeout(timer);
  }
}

export const NO_UPDATE: UpdateState = { available: false, mandatory: false, versionName: null, url: null, note: null };

/** 有新版本 0.5.16, or just 有新版本 when the name is unknown (Play reports only the versionCode). */
export function updateTitle(state: UpdateState): string {
  return state.versionName ? `有新版本 ${state.versionName}` : '有新版本';
}

/** The 更新 button's spoken label, without an unknown version read out as null. */
export function updateActionLabel(state: UpdateState): string {
  return state.versionName ? `更新到 ${state.versionName}` : '更新';
}

/**
 * A published record is only usable if every field the banner needs is present and sane.
 *
 * Deliberately strict: this decides whether to interrupt somebody, and a malformed file should read
 * as "no update" rather than as an undismissable banner pointing at undefined.
 */
export function readPublishedVersion(value: unknown): PublishedVersion | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const versionCode = record.versionCode;
  const versionName = record.versionName;
  const url = record.url;
  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode <= 0) return null;
  if (typeof versionName !== 'string' || !versionName.trim()) return null;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  return {
    versionCode,
    versionName: versionName.trim(),
    url,
    mandatory: record.mandatory === true,
    note: typeof record.note === 'string' && record.note.trim() ? record.note.trim() : undefined,
  };
}

/** Compare what is published against what is running. Equal or older is not an update. */
export function compareToInstalled(published: PublishedVersion | null, installedVersionCode: number | null): UpdateState {
  if (!published || installedVersionCode === null) return NO_UPDATE;
  if (published.versionCode <= installedVersionCode) return NO_UPDATE;
  return {
    available: true,
    mandatory: published.mandatory === true,
    versionName: published.versionName,
    url: published.url,
    note: published.note ?? null,
  };
}

/**
 * Ask, and treat every failure as "no update".
 *
 * There is no cached last-good here on purpose, unlike the announcement. A stale announcement is
 * still worth reading; a stale update notice would keep telling somebody to install a version they
 * already have, and being nagged by a wrong banner is worse than not being told.
 */
export async function fetchUpdateState(
  installedVersionCode: number | null,
  platform: string,
  fetchImpl: typeof fetch = fetch,
  url: string = VERSION_URL,
): Promise<UpdateState> {
  // The published build here is a sideloaded APK, and App Review guideline 2.5.2 forbids pointing an iPhone
  // at an installer, so iOS never reads these fields; a TestFlight iPhone reads the `ios` block instead
  // (fetchTestflightUpdateState). The caller passes Platform.OS: this module stays free of react-native
  // because the Node release check (verify-install-link) imports it.
  if (platform !== 'android') return NO_UPDATE;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return NO_UPDATE;
    return compareToInstalled(readPublishedVersion(await response.json()), installedVersionCode);
  } catch {
    return NO_UPDATE;
  } finally {
    clearTimeout(timer);
  }
}
