import * as InAppUpdates from 'expo-in-app-updates';
import { fetchUpdateState, NO_UPDATE, type UpdateState } from './updateCheck';

/**
 * Which update to offer, and what 更新 does.
 *
 * 光佑 (2026-10-13): Play took hours to update his phone on its own, so the app now asks Play itself
 * and 更新 runs Play's in-app update (the official Play Core flow, through expo-in-app-updates), behind
 * the same prompt, notice-board card and reader line as before. A build installed some other way — a
 * sideloaded APK from the install page — keeps the published version file and its install page.
 *
 * Kept apart from updateCheck.ts on purpose: that module must load in the Node release scripts, and
 * this one pulls in a native module.
 */
export const PLAY_LISTING_URL = 'https://play.google.com/store/apps/details?id=org.qingmu.youth';

interface PlayAnswer { updateAvailable: boolean }

/**
 * Play answers for the installs it manages, including which test track this account is on. When it
 * does not manage this install it fails (Play Core install error -10, "app not owned"), and so does
 * a phone without Play; only then is the published version file asked.
 */
export async function checkAppUpdate(
  installedVersionCode: number | null,
  platform: string,
  { play = (): Promise<PlayAnswer> => InAppUpdates.checkForUpdate(), manifest = fetchUpdateState }: {
    play?: () => Promise<PlayAnswer>;
    manifest?: (installed: number | null, platform: string) => Promise<UpdateState>;
  } = {},
): Promise<UpdateState> {
  // iOS updates from the App Store, and App Review guideline 2.5.2 forbids pointing it at anything
  // else, so it asks nobody: no Play call and no network request.
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
 * build opens its install page at once, exactly as before.
 */
export function startAppUpdate(
  state: UpdateState,
  open: (url: string) => void,
  start: () => Promise<boolean> = () => InAppUpdates.startUpdate(true),
): Promise<void> {
  const url = state.url;
  if (!url) return Promise.resolve();
  if (!state.viaPlay) {
    open(url);
    return Promise.resolve();
  }
  return start().then((started) => { if (!started) open(url); }, () => { open(url); });
}
