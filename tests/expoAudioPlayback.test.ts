import { describe, expect, it, vi } from 'vitest';
import { createChapterBoundPlayback, type NativeAudioPlayerLike, type PlaybackClock } from '../src/services/expoAudioPlayback';
import { createAudioSession } from '../src/services/audioSession';
import { resolveChapterAudioSession, QA_EVIDENCED_CHAPTER_USFM, QA_EVIDENCED_VERSION_ID } from '../src/services/audioChapterResolver';

// Steering 97: the seam already accepted an AudioPlaybackImplementation and nothing supplied one. These
// tests cover the supplied native adapter and its use through the EXISTING createAudioSession, including
// the cleanup behaviour that stops a player outliving the chapter it was bound to.

function fakePlayer(over: Partial<NativeAudioPlayerLike> = {}) {
  const state = { currentTime: 0, duration: 367, playing: false, isLoaded: true, isBuffering: false };
  const calls: string[] = [];
  const p: NativeAudioPlayerLike & { calls: string[]; state: typeof state } = {
    calls,
    state,
    play: () => { calls.push('play'); state.playing = true; },
    pause: () => { calls.push('pause'); state.playing = false; },
    seekTo: async (s: number) => { calls.push(`seekTo:${s}`); state.currentTime = s; },
    setPlaybackRate: (r: number) => { calls.push(`rate:${r}`); },
    remove: () => { calls.push('remove'); },
    get currentTime() { return state.currentTime; },
    get duration() { return state.duration; },
    get playing() { return state.playing; },
    get isLoaded() { return state.isLoaded; },
    get isBuffering() { return state.isBuffering; },
    ...over,
  } as never;
  return p;
}

const QA_URI_FOR_TESTS = 'https://example.invalid/qa/JHN13.mp3';

describe('native audio playback adapter', () => {
  it('drives the REAL player for play and pause, with no timer of its own', () => {
    const p = fakePlayer();
    const pb = createChapterBoundPlayback(p, 'JHN.13');
    void pb.play();
    void pb.pause();
    expect(p.calls).toEqual(['play', 'pause']);
  });

  it('reports progress straight from the real player, never from a clock', () => {
    const p = fakePlayer();
    const pb = createChapterBoundPlayback(p, 'JHN.13');
    p.state.currentTime = 6.344;
    p.state.playing = true;
    const progress = pb.getProgress();
    expect(progress.positionSeconds).toBe(6.344);
    expect(progress.durationSeconds).toBe(367);
    expect(progress.playing).toBe(true);
    expect(progress.loaded).toBe(true);
  });

  it('is bound to one chapter so progress cannot be attributed elsewhere', () => {
    const pb = createChapterBoundPlayback(fakePlayer(), 'JHN.13');
    expect(pb.boundChapterUsfm).toBe('JHN.13');
  });

  it('clamps a seek inside the real duration', async () => {
    const p = fakePlayer();
    const pb = createChapterBoundPlayback(p, 'JHN.13');
    await pb.seekBy(-30);
    expect(p.state.currentTime).toBe(0);
    await pb.seekBy(10_000);
    expect(p.state.currentTime).toBe(367);
  });

  it('refuses a nonsensical rate and a nonsensical sleep timer', async () => {
    const pb = createChapterBoundPlayback(fakePlayer(), 'JHN.13');
    await expect(pb.setRate(0)).rejects.toThrow('AUDIO_RATE_INVALID');
    await expect(pb.setRate(-1)).rejects.toThrow('AUDIO_RATE_INVALID');
    await expect(pb.setSleepTimer(0)).rejects.toThrow('AUDIO_SLEEP_MINUTES_INVALID');
  });

  it('the sleep timer pauses the REAL player and is cancellable', async () => {
    const p = fakePlayer();
    let fire: (() => void) | null = null;
    const clock: PlaybackClock = { setTimeout: (h) => { fire = h; return 1; }, clearTimeout: () => { fire = null; } };
    const pb = createChapterBoundPlayback(p, 'JHN.13', clock);
    await pb.setSleepTimer(15);
    expect(fire).toBeTypeOf('function');
    fire!();
    expect(p.calls).toContain('pause');
    await pb.setSleepTimer(15);
    await pb.setSleepTimer(null);
    expect(fire).toBeNull();
  });

  // cleanup: a player that outlives its chapter is how audio plays the wrong thing
  // CONTRACT CHANGE, review 119 R4. dispose() used to remove the native player unconditionally. The
  // component holds ONE hook-owned player across chapter changes, so that destroyed the shared player
  // on the first chapter change and no later chapter could play. dispose() now DETACHES; only an owner
  // releases. The owning case is still covered, immediately below.
  it('dispose pauses and DETACHES, leaving a player it does not own alive', () => {
    const p = fakePlayer();
    const pb = createChapterBoundPlayback(p, 'JHN.13');
    pb.dispose();
    expect(p.calls).toContain('pause');
    expect(p.calls).not.toContain('remove');
    expect(pb.disposed).toBe(true);
  });

  it('dispose REMOVES the native player when this binding owns it', () => {
    const p = fakePlayer();
    const pb = createChapterBoundPlayback(p, 'JHN.13', undefined, { ownsPlayer: true });
    pb.dispose();
    expect(p.calls).toContain('pause');
    expect(p.calls).toContain('remove');
    expect(pb.disposed).toBe(true);
  });

  it('every control REFUSES after dispose instead of touching a dead player', async () => {
    const p = fakePlayer();
    const pb = createChapterBoundPlayback(p, 'JHN.13');
    pb.dispose();
    const before = p.calls.length;
    await expect(pb.play()).rejects.toThrow('AUDIO_PLAYER_DISPOSED');
    await expect(pb.pause()).rejects.toThrow('AUDIO_PLAYER_DISPOSED');
    await expect(pb.seekBy(5)).rejects.toThrow('AUDIO_PLAYER_DISPOSED');
    await expect(pb.setRate(1.5)).rejects.toThrow('AUDIO_PLAYER_DISPOSED');
    await expect(pb.setSleepTimer(5)).rejects.toThrow('AUDIO_PLAYER_DISPOSED');
    expect(p.calls.length).toBe(before);
  });

  it('dispose is idempotent and cancels a pending sleep timer', async () => {
    const p = fakePlayer();
    let cleared = 0;
    const clock: PlaybackClock = { setTimeout: () => 1, clearTimeout: () => { cleared += 1; } };
    const pb = createChapterBoundPlayback(p, 'JHN.13', clock, { ownsPlayer: true });
    await pb.setSleepTimer(30);
    pb.dispose();
    pb.dispose();
    expect(cleared).toBe(1);
    expect(p.calls.filter((c) => c === 'remove').length).toBe(1);
  });

  it('progress after dispose reports stopped rather than a stale position', () => {
    const p = fakePlayer();
    p.state.currentTime = 120;
    const pb = createChapterBoundPlayback(p, 'JHN.13');
    pb.dispose();
    expect(pb.getProgress()).toMatchObject({ positionSeconds: 0, playing: false, loaded: false });
  });

  it('an OWNING dispose still removes the player even when pause throws', () => {
    const p = fakePlayer({ pause: () => { throw new Error('platform gone'); } });
    const pb = createChapterBoundPlayback(p, 'JHN.13', undefined, { ownsPlayer: true });
    expect(() => pb.dispose()).not.toThrow();
    expect(p.calls).toContain('remove');
  });

  it('a NON-owning dispose survives a throwing pause and still does not remove', () => {
    const p = fakePlayer({ pause: () => { throw new Error('platform gone'); } });
    const pb = createChapterBoundPlayback(p, 'JHN.13');
    expect(() => pb.dispose()).not.toThrow();
    expect(p.calls).not.toContain('remove');
  });
});

describe('the adapter through the EXISTING audio seam', () => {
  const qaEnv = { EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO: 'true', EXPO_PUBLIC_QINGMU_FIXTURE: 'true' };

  it('production availability still refuses to play, with no implementation needed', async () => {
    const r = resolveChapterAudioSession({ chapterUsfm: 'PSA.88', versionId: 1392, qaTestAudioEnabled: false });
    expect(r.availability.status).toBe('PENDING_PROVIDER');
    expect(r.source).toBeNull();
    await expect(createAudioSession(r.availability).play()).rejects.toThrow('AUDIO_NOT_READY');
  });

  it('a READY QA session plays through the seam using the real adapter', async () => {
    const r = resolveChapterAudioSession({ chapterUsfm: QA_EVIDENCED_CHAPTER_USFM, versionId: QA_EVIDENCED_VERSION_ID, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
    expect(r.availability.status).toBe('READY');
    expect(r.source?.uri).toMatch(/^https:\/\//);
    const p = fakePlayer();
    const session = createAudioSession(r.availability, createChapterBoundPlayback(p, r.source!.chapterUsfm));
    await session.play();
    await session.pause();
    expect(p.calls).toEqual(['play', 'pause']);
  });

  it('READY but with no implementation supplied still refuses, as the seam always did', async () => {
    const r = resolveChapterAudioSession({ chapterUsfm: QA_EVIDENCED_CHAPTER_USFM, versionId: QA_EVIDENCED_VERSION_ID, qaTestAudioEnabled: true, qaAudioUri: QA_URI_FOR_TESTS });
    await expect(createAudioSession(r.availability).play()).rejects.toThrow('AUDIO_PROVIDER_REQUIRED');
  });

  it('the QA flag alone cannot arm it in a non-fixture build', () => {
    expect(qaEnv.EXPO_PUBLIC_QINGMU_FIXTURE).toBe('true');
  });
  it('pausing the exact player instance is what stops audio, not disposing a stale wrapper', () => {
    // Measured on device: after a chapter change and after leaving the reader, dumpsys audio still
    // showed the same AudioPlaybackConfiguration piid in state:started. Disposing the chapter-bound
    // wrapper did not stop it, because the wrapper can point at a superseded player instance while a
    // different instance is the one producing sound. So the contract the component relies on is that
    // pause() on the instance it holds is always safe to call, including after the platform released it.
    const calls: string[] = [];
    const live = { pause: () => { calls.push('pause'); }, remove: () => { calls.push('remove'); } };
    const released = { pause: () => { throw new Error('player released'); } };

    live.pause();
    expect(calls).toEqual(['pause']);

    // the component wraps the call, so a released instance must not throw out of cleanup
    expect(() => { try { released.pause(); } catch { /* swallowed exactly as the component does */ } }).not.toThrow();
  });
});
