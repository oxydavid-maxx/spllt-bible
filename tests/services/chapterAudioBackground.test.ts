import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  setAudioModeAsync: vi.fn(async (_mode: unknown) => undefined),
  fromModule: vi.fn(),
}));
vi.mock('expo-audio', () => ({ setAudioModeAsync: native.setAudioModeAsync }));
vi.mock('expo-asset', () => ({ Asset: { fromModule: native.fromModule } }));
// The card artwork is a bundled image; its module id is all the startup hands to expo-asset.
vi.mock('../../src/ui/brandIcon', () => ({ BRAND_ICON: 7, MEDIA_ARTWORK: 8 }));

import {
  CHAPTER_AUDIO_LOCK_SCREEN_OPTIONS, CHAPTER_AUDIO_MODE, chapterAudioArtwork, chapterAudioCardMetadata, setChapterAudioArtwork,
} from '../../src/services/chapterAudioBackground';
import { configureChapterAudio } from '../../src/services/chapterAudioStartup';

// 光佑 2026-09-28 (mock jhuke-audio-bg-mock-0928): narration keeps going across tabs, other apps and a
// locked screen, like YouTube, and the notification shade and lock screen carry a 竹科聖經 media card.
describe('background chapter audio', () => {
  beforeEach(() => { setChapterAudioArtwork(Promise.resolve(undefined)); });

  it('plays in the background, takes audio focus so a call or another app pauses it, and ignores the ringer switch', () => {
    // doNotMix is what expo-audio requires for lock-screen controls (Audio.types.d.ts, InterruptionMode).
    expect(CHAPTER_AUDIO_MODE).toEqual({ shouldPlayInBackground: true, interruptionMode: 'doNotMix', playsInSilentMode: true });
  });

  it('names the card after the chapter, the version and the app, and shows the app icon', () => {
    expect(chapterAudioCardMetadata('JHN.3', 46, 'file:///cache/icon.png')).toEqual({
      title: '約翰福音 3 章', artist: '和合本（神版，繁體） · 竹科聖經', artworkUrl: 'file:///cache/icon.png',
    });
    expect(chapterAudioCardMetadata('PSA.23', 40, undefined)).toEqual({ title: '詩篇 23 篇', artist: '新譯本（繁體） · 竹科聖經' });
    expect(chapterAudioCardMetadata('JHN.3', null, undefined)).toEqual({ title: '約翰福音 3 章', artist: '竹科聖經' });
  });

  it('puts pause/play between a step back and a step forward on the card', () => {
    expect(CHAPTER_AUDIO_LOCK_SCREEN_OPTIONS).toEqual({ showSeekBackward: true, showSeekForward: true });
  });
});

describe('configureChapterAudio (app startup)', () => {
  beforeEach(() => { setChapterAudioArtwork(Promise.resolve(undefined)); });

  it('sets the background audio mode and hands the card the bundled app icon as a local file', async () => {
    const localUri = 'file:///data/user/0/org.qingmu.youth/cache/ExponentAsset-4f1c.png';
    native.fromModule.mockReturnValue({ downloadAsync: async () => ({ localUri }) });
    await configureChapterAudio();
    expect(native.setAudioModeAsync).toHaveBeenCalledExactlyOnceWith({ shouldPlayInBackground: true, interruptionMode: 'doNotMix', playsInSilentMode: true });
    // expo-audio's Android service reads artwork through java.net.URL: a file:// URL of the icon
    // copied out of the APK loads offline; a bare resource name ("assets_icon") would not parse.
    // The 512 x 512 copy of the icon (assets/media-artwork.png), not the 1024 x 1024 icon.png.
    expect(native.fromModule).toHaveBeenCalledExactlyOnceWith(8);
    await expect(chapterAudioArtwork()).resolves.toBe(localUri);
  });

  it('still configures background audio when the icon cannot be copied; the card then has no artwork', async () => {
    native.fromModule.mockReturnValue({ downloadAsync: async () => { throw new Error('resource missing'); } });
    await configureChapterAudio();
    expect(native.setAudioModeAsync).toHaveBeenCalledOnce();
    await expect(chapterAudioArtwork()).resolves.toBeUndefined();
  });

  it('never hands the card a location java.net.URL cannot open', async () => {
    native.fromModule.mockReturnValue({ downloadAsync: async () => ({ localUri: 'assets_icon' }) });
    await configureChapterAudio();
    await expect(chapterAudioArtwork()).resolves.toBeUndefined();
  });
});
