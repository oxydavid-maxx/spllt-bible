// tests/doubles/expo-audio.ts
// Module-resolution double for expo-audio, used ONLY by vitest via an alias in vitest.config.ts.
//
// Why it exists: expo-audio pulls in expo-modules-core's native registry at import time, which does not
// exist in the node test environment. Rendering the reader now imports the audio controls, so a test
// that only wanted to check reader identity would fail on a missing native module.
//
// What it is NOT: this is not a fake that can make an audio claim pass. It returns an inert player with
// zero position and playing=false, so nothing here can look like playback. The adapter's real behaviour
// is covered in tests/expoAudioPlayback.test.ts against an explicit fake whose calls are asserted, and
// actual playback is only ever claimed from device evidence off the real player.

export function useAudioPlayer(_source?: unknown, _options?: unknown) {
  return {
    id: 'test-double',
    play: () => undefined,
    pause: () => undefined,
    seekTo: async () => undefined,
    setPlaybackRate: () => undefined,
    remove: () => undefined,
    addListener: () => ({ remove: () => undefined }),
    currentTime: 0,
    duration: 0,
    playing: false,
    paused: true,
    isLoaded: false,
    isBuffering: false,
  };
}

export function useAudioPlayerStatus() {
  return { isLoaded: false, playing: false, currentTime: 0, duration: 0 };
}

export async function setAudioModeAsync() {
  return undefined;
}
