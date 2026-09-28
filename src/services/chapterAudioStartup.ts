// chapterAudioStartup.ts
// Run once when the app starts (app/_layout.tsx): the background audio mode, and the app icon for the
// media card. Kept apart from chapterAudioBackground.ts because both reach native modules.

import { Asset } from 'expo-asset';
import { setAudioModeAsync } from 'expo-audio';
import { BRAND_ICON } from '../ui/brandIcon';
import { CHAPTER_AUDIO_MODE, setChapterAudioArtwork } from './chapterAudioBackground';

/**
 * expo-audio's Android service opens the card's artworkUrl with java.net.URL (AudioControlsService.kt,
 * loadArtworkFromUrl) and media3 reads the same URL for the lock screen. In a release APK the bundled
 * icon is a drawable named "assets_icon", which java.net.URL cannot open, so expo-asset copies it into
 * the app's cache and the card gets that file:// URL: the real icon, with no network involved.
 */
async function bundledIconFile(): Promise<string | undefined> {
  try {
    const asset = await Asset.fromModule(BRAND_ICON).downloadAsync();
    return asset.localUri?.startsWith('file://') ? asset.localUri : undefined;
  } catch {
    return undefined; // a card without artwork still plays and pauses
  }
}

export async function configureChapterAudio(): Promise<void> {
  setChapterAudioArtwork(bundledIconFile());
  await setAudioModeAsync(CHAPTER_AUDIO_MODE);
}
