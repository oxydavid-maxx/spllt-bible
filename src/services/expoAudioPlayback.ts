// expoAudioPlayback.ts
// THE MISSING NATIVE IMPLEMENTATION for the existing audio seam (steering 97).
//
// src/services/audioSession.ts has always accepted an injected AudioPlaybackImplementation and nothing
// ever supplied one. That, not the provider question, was the actual stop. This file supplies it.
//
// It is a thin adapter over expo-audio, which Expo 56 itself pins at ~56.0.13 in its
// bundledNativeModules. expo-audio wraps the platform player, the same mechanism the standalone POC
// drove directly through Android MediaPlayer. So this reuses the platform's native playback rather than
// introducing a decoder or a player framework, and no YouVersion-specific player class is needed: the
// seam only asks for play, pause, seekBy, setRate and setSleepTimer.
//
// HONESTY RULES BUILT IN:
//   - position and duration come from the real player's currentTime and duration. There is no timer
//     anywhere in this file, because a simulated clock is not playback evidence.
//   - a sleep timer is a real scheduled pause on the real player, not a fake progress source.
//   - dispose() exists so chapter switch, screen exit and error all release the native player. Leaking
//     a player across chapters is how audio ends up playing the wrong thing.

import type { AudioPlaybackImplementation } from './audioSession';

/** The slice of expo-audio's AudioPlayer this adapter needs. Declared so it can be unit-tested. */
export interface NativeAudioPlayerLike {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  setPlaybackRate(rate: number): void;
  remove(): void;
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly isLoaded: boolean;
  readonly isBuffering: boolean;
}

export interface PlaybackProgress {
  positionSeconds: number;
  durationSeconds: number;
  playing: boolean;
  loaded: boolean;
  buffering: boolean;
}

export interface ChapterBoundPlayback extends AudioPlaybackImplementation {
  /** The chapter this player is bound to. Progress must never be attributed to another chapter. */
  readonly boundChapterUsfm: string;
  /** Read straight from the real player. */
  getProgress(): PlaybackProgress;
  /** Release the native player: chapter switch, screen exit, or error. */
  dispose(): void;
  readonly disposed: boolean;
}

export interface PlaybackClock {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: PlaybackClock = {
  setTimeout: (h, ms) => setTimeout(h, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Bind a real native player to one chapter and expose it through the existing seam.
 * @param player the real expo-audio AudioPlayer
 * @param boundChapterUsfm the chapter this player plays, used to refuse cross-chapter attribution
 */
export function createChapterBoundPlayback(
  player: NativeAudioPlayerLike,
  boundChapterUsfm: string,
  clock: PlaybackClock = realClock,
  options: { ownsPlayer?: boolean } = {},
): ChapterBoundPlayback {
  let disposed = false;
  let sleepHandle: unknown = null;
  // REVIEW 119 R4. Defaults to FALSE, and that default is the fix.
  //
  // The caller in ChapterAudioControls holds ONE player from useAudioPlayer for the component's whole
  // lifetime, and expo-audio releases that player on UNMOUNT. The component does not unmount when the
  // chapter changes. So the previous code, which called player.remove() from this wrapper's dispose on
  // every chapter change, destroyed the shared native player the first time the reader changed chapter
  // - and because the hook kept handing back that same removed instance, no later chapter could play.
  // A -> B -> A was permanently broken after the first switch.
  //
  // Ownership is now explicit: whoever created the player releases it. A binding only ever DETACHES.
  const ownsPlayer = options.ownsPlayer === true;

  const assertLive = () => {
    if (disposed) throw new Error('AUDIO_PLAYER_DISPOSED');
  };
  const clearSleep = () => {
    if (sleepHandle !== null) {
      clock.clearTimeout(sleepHandle);
      sleepHandle = null;
    }
  };

  return {
    boundChapterUsfm,
    get disposed() {
      return disposed;
    },
    play: async () => {
      assertLive();
      player.play();
    },
    pause: async () => {
      assertLive();
      player.pause();
    },
    seekBy: async (seconds: number) => {
      assertLive();
      // clamp to the real duration so a seek can never run past the recording
      const target = Math.max(0, Math.min(player.currentTime + seconds, player.duration || Number.MAX_SAFE_INTEGER));
      await player.seekTo(target);
    },
    setRate: async (rate: number) => {
      assertLive();
      if (!(rate > 0)) throw new Error('AUDIO_RATE_INVALID');
      player.setPlaybackRate(rate);
    },
    setSleepTimer: async (minutes: number | null) => {
      assertLive();
      clearSleep();
      if (minutes === null) return;
      if (!(minutes > 0)) throw new Error('AUDIO_SLEEP_MINUTES_INVALID');
      // a real scheduled pause on the real player; it does not drive progress
      sleepHandle = clock.setTimeout(() => {
        sleepHandle = null;
        if (!disposed) player.pause();
      }, minutes * 60_000);
    },
    getProgress: () => {
      if (disposed) return { positionSeconds: 0, durationSeconds: 0, playing: false, loaded: false, buffering: false };
      return {
        positionSeconds: player.currentTime,
        durationSeconds: player.duration,
        playing: player.playing,
        loaded: player.isLoaded,
        buffering: player.isBuffering,
      };
    },
    dispose: () => {
      if (disposed) return;
      clearSleep();
      disposed = true;
      try {
        player.pause();
      } catch {
        // pausing a player the platform already tore down must not mask the dispose
      }
      // Only the OWNER releases the native resource. A hook-owned player is released by the hook on
      // unmount; removing it here would destroy an instance the component still depends on.
      if (ownsPlayer) player.remove();
    },
  };
}
