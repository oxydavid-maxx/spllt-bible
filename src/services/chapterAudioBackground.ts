// chapterAudioBackground.ts
// What keeps chapter narration going once the member leaves the Reader, and what the phone shows while it does.
//
// Two halves, both required on Android (光佑 2026-09-28, mock jhuke-audio-bg-mock-0928):
//   - the audio MODE, set once at startup (chapterAudioStartup.ts). Without shouldPlayInBackground,
//     expo-audio pauses every player the moment the activity goes to the background (AudioModule.kt,
//     OnActivityEntersBackground).
//   - the lock-screen SESSION, which the Reader's one audio owner activates when a chapter starts. It is
//     the media card in the notification shade and on the lock screen, and it is also what keeps Android
//     from stopping background audio after about three minutes (Audio.types.d.ts, shouldPlayInBackground).
//
// This file is deliberately free of native imports so the Reader's audio controls can use it in tests.

import type { AudioLockScreenOptions, AudioMetadata, AudioMode } from 'expo-audio';
import { getYouVersionContentMetadata } from '../config/youVersionContent';
import { formatChapterNameZhTw } from '../domain/scriptureReference';

/** doNotMix takes audio focus: a call or another app starting sound pauses the reading, like a podcast.
 * expo-audio also requires doNotMix for lock-screen controls. */
export const CHAPTER_AUDIO_MODE = {
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
  playsInSilentMode: true,
} as const satisfies Partial<AudioMode>;

/** Pause/play between a ten-second step back and forward, as podcast cards have. */
export const CHAPTER_AUDIO_LOCK_SCREEN_OPTIONS = {
  showSeekBackward: true,
  showSeekForward: true,
} as const satisfies AudioLockScreenOptions;

const APP_NAME = '竹科聖經';

/** The card: 約翰福音 3 章 / 和合本（神版，繁體） · 竹科聖經 / the app icon. */
export function chapterAudioCardMetadata(chapterUsfm: string, versionId: number | null, artworkUrl: string | undefined): AudioMetadata {
  const versionName = getYouVersionContentMetadata(versionId)?.translationName;
  return {
    title: formatChapterNameZhTw(chapterUsfm),
    artist: versionName ? `${versionName} · ${APP_NAME}` : APP_NAME,
    ...(artworkUrl ? { artworkUrl } : {}),
  };
}

// The icon is copied out of the APK once at startup; the card waits for that copy rather than
// appearing once without its logo.
let artwork: Promise<string | undefined> = Promise.resolve(undefined);

export function setChapterAudioArtwork(pending: Promise<string | undefined>): void {
  artwork = pending;
}

export function chapterAudioArtwork(): Promise<string | undefined> {
  return artwork;
}
