/**
 * Whether a newer build exists, decided from a small file published beside the APK.
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
}

export const NO_UPDATE: UpdateState = { available: false, mandatory: false, versionName: null, url: null, note: null };

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
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(VERSION_URL, { signal: controller.signal });
    if (!response.ok) return NO_UPDATE;
    return compareToInstalled(readPublishedVersion(await response.json()), installedVersionCode);
  } catch {
    return NO_UPDATE;
  } finally {
    clearTimeout(timer);
  }
}
