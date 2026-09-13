import { describe, expect, it } from 'vitest';
import { createChapterBoundPlayback, type NativeAudioPlayerLike } from '../../src/services/expoAudioPlayback';

// Review 119 R4. The shipped wrapper called player.remove() from dispose() on EVERY chapter change,
// while the component held ONE hook-owned player for its whole lifetime. So the first chapter change
// destroyed the shared native player and no later chapter could ever play. These tests fail against
// that code and pass against explicit ownership.

/** A native player that behaves like a real one: once removed, it is dead and says so. */
function fakePlayer() {
  const calls = { play: 0, pause: 0, remove: 0 };
  let removed = false;
  const player: NativeAudioPlayerLike = {
    play: () => {
      if (removed) throw new Error('NATIVE_PLAYER_REMOVED');
      calls.play += 1;
    },
    pause: () => {
      if (removed) throw new Error('NATIVE_PLAYER_REMOVED');
      calls.pause += 1;
    },
    seekTo: async () => {
      if (removed) throw new Error('NATIVE_PLAYER_REMOVED');
    },
    setPlaybackRate: () => {
      if (removed) throw new Error('NATIVE_PLAYER_REMOVED');
    },
    remove: () => {
      calls.remove += 1;
      removed = true;
    },
    currentTime: 0,
    duration: 100,
    playing: false,
    isLoaded: true,
    isBuffering: false,
  };
  return { player, calls, isRemoved: () => removed };
}

describe('a chapter binding does not destroy a player it does not own (R4)', () => {
  it('DETACHES on dispose and leaves the hook-owned player alive', () => {
    const { player, calls, isRemoved } = fakePlayer();
    const bound = createChapterBoundPlayback(player, 'JHN.13');
    bound.dispose();
    expect(bound.disposed).toBe(true);
    expect(calls.remove).toBe(0);
    expect(isRemoved()).toBe(false);
  });

  it('supports A -> B -> A on ONE shared player, which the old code made impossible', async () => {
    const { player, calls, isRemoved } = fakePlayer();

    const a1 = createChapterBoundPlayback(player, 'JHN.13');
    await a1.play();
    await a1.pause();
    a1.dispose(); // chapter change away from A

    const b = createChapterBoundPlayback(player, 'PSA.90');
    await b.play(); // this threw NATIVE_PLAYER_REMOVED under the old code
    await b.pause();
    b.dispose(); // chapter change back

    const a2 = createChapterBoundPlayback(player, 'JHN.13');
    await a2.play();
    await a2.pause();

    expect(isRemoved()).toBe(false);
    expect(calls.remove).toBe(0);
    expect(calls.play).toBe(3);
  });

  it('still releases the native player when the caller genuinely OWNS it', () => {
    const { player, calls } = fakePlayer();
    const owned = createChapterBoundPlayback(player, 'JHN.13', undefined, { ownsPlayer: true });
    owned.dispose();
    expect(calls.remove).toBe(1);
  });

  it('pauses on dispose, so a chapter change stops the sound even though it does not remove', () => {
    const { player, calls } = fakePlayer();
    const bound = createChapterBoundPlayback(player, 'JHN.13');
    bound.dispose();
    expect(calls.pause).toBe(1);
  });

  it('is idempotent: disposing twice does not double-release or throw', () => {
    const { player, calls } = fakePlayer();
    const owned = createChapterBoundPlayback(player, 'JHN.13', undefined, { ownsPlayer: true });
    owned.dispose();
    owned.dispose();
    expect(calls.remove).toBe(1);
  });
});

describe('a disposed binding refuses to act, so an old chapter cannot drive the new one (R4)', () => {
  it('rejects play/pause/seek after dispose', async () => {
    const { player } = fakePlayer();
    const bound = createChapterBoundPlayback(player, 'JHN.13');
    bound.dispose();
    await expect(bound.play()).rejects.toThrow('AUDIO_PLAYER_DISPOSED');
    await expect(bound.pause()).rejects.toThrow('AUDIO_PLAYER_DISPOSED');
    await expect(bound.seekBy(15)).rejects.toThrow('AUDIO_PLAYER_DISPOSED');
  });

  it('reports zeroed progress once disposed instead of the live player\'s numbers', () => {
    const { player } = fakePlayer();
    const bound = createChapterBoundPlayback(player, 'JHN.13');
    bound.dispose();
    expect(bound.getProgress()).toEqual({ positionSeconds: 0, durationSeconds: 0, playing: false, loaded: false, buffering: false });
  });

  it('keeps the chapter it is bound to, so progress can never be attributed to another chapter', () => {
    const { player } = fakePlayer();
    expect(createChapterBoundPlayback(player, 'PSA.90').boundChapterUsfm).toBe('PSA.90');
  });

  it('does not let a stale binding cancel the live one: disposing A leaves B usable', async () => {
    const { player } = fakePlayer();
    const a = createChapterBoundPlayback(player, 'JHN.13');
    const b = createChapterBoundPlayback(player, 'PSA.90');
    a.dispose(); // the late rejection path used to dispose whatever was current
    expect(b.disposed).toBe(false);
    await expect(b.play()).resolves.toBeUndefined();
  });
});

describe('falsification: this suite really does discriminate old code from new (R6)', () => {
  it('reproduces the SHIPPED behaviour with ownsPlayer:true and shows it broke A -> B', async () => {
    // ownsPlayer:true is exactly what the old dispose() did unconditionally. If this test ever stops
    // failing-by-construction, the ownership fix has been silently undone.
    const { player } = fakePlayer();
    const a = createChapterBoundPlayback(player, 'JHN.13', undefined, { ownsPlayer: true });
    a.dispose();
    const b = createChapterBoundPlayback(player, 'PSA.90');
    await expect(b.play()).rejects.toThrow('NATIVE_PLAYER_REMOVED');
  });
});
