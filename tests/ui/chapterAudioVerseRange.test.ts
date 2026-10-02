// Half-chapter days (maintainer 2026-10-02): the narration starts at the range's first verse and stops by
// itself after the last one, which counts as the end of that passage (連讀 moves on from there). A
// recording without per-verse timing reads the whole chapter, and says so. The harness is the one
// tests/ui/chapterAudioContinuousPlayback.test.ts uses.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
const native = vi.hoisted(() => ({ player: null as any }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => native.player }));

import { ChapterAudioControls, ChapterAudioAutoplayContext, type ChapterAudioAutoplayContextValue } from '../../src/ui/ChapterAudioControls';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

const TIMING = [
  { verse: 1, start: 2.9, end: 9.5 },
  { verse: 2, start: 9.5, end: 14 },
  { verse: 3, start: 14, end: 20 },
  { verse: 4, start: 20.4, end: 26 },
];
const response = (body: unknown) => new Response(JSON.stringify(body));
const payload = (verseTiming?: typeof TIMING) => ({
  identity: { versionId: 46, usfm: 'PSA.119' }, text: true, audio: true, offline: false,
  status: 'verified_source', reason: '', uri: 'https://example.test/PSA.119.mp3', providerExpiry: null,
  validUntil: new Date('2030-01-01T00:00:00Z').toISOString(),
  provenance: { publisher: 'Test', edition: 'Test', recordingId: 'test', reference: 'PSA.119', attribution: 'Test' },
  ...(verseTiming ? { verseTiming } : {}),
});

let view: TestRenderer.ReactTestRenderer | null = null;
let listeners: Set<(status: any) => void>;
let context: ChapterAudioAutoplayContextValue;

beforeEach(() => {
  setAuthSession({ memberId: 'A', sessionToken: 'session-A' });
  listeners = new Set();
  const p: any = {
    currentTime: 0, duration: 30, playing: false, isLoaded: true, isBuffering: false, calls: [] as string[],
    play() { p.playing = true; p.calls.push('play'); }, pause() { p.playing = false; p.calls.push('pause'); },
    replace(source: { uri: string }) { p.calls.push(`replace:${source.uri}`); },
    seekTo: async (value: number) => { p.currentTime = value; p.calls.push(`seek:${value}`); },
    setPlaybackRate() {}, remove() {}, addListener(_event: string, listener: (status: any) => void) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
  };
  native.player = p;
  context = {
    available: true, enabled: false, intent: null, notice: null, cancel: vi.fn(), toggle: vi.fn(),
    onPlaybackStarted: vi.fn(), onPlaybackPaused: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(), onAutoplayUnavailable: vi.fn(), onPlayingVerse: vi.fn(),
  };
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = null; clearAuthSession(); vi.useRealTimers(); });

const element = (verseRange: { first: number; last: number } | null, onNarrationScope: (scope: 'range' | 'chapter' | null) => void, verseTiming?: typeof TIMING) =>
  React.createElement(ChapterAudioAutoplayContext.Provider, { value: context }, React.createElement(ChapterAudioControls, {
    chapterUsfm: 'PSA.119', versionId: 46, env: { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' },
    baseUrl: 'https://in-memory.test', fetchImpl: (async () => response(payload(verseTiming))) as typeof fetch,
    verseRange, onNarrationScope,
  } as never));
const mount = async (verseRange: { first: number; last: number } | null, verseTiming: typeof TIMING | null = TIMING, onNarrationScope = vi.fn()) => {
  await act(async () => { view = TestRenderer.create(element(verseRange, onNarrationScope, verseTiming ?? undefined)); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return onNarrationScope;
};
const press = async () => {
  const button = view!.root.findAll(node => String(node.type) === 'Pressable')[0];
  await act(async () => { button.props.onPress(); for (let i = 0; i < 6; i++) await Promise.resolve(); });
};
// Pauses since the last play (binding a source pauses the player too).
const pausedSincePlay = () => native.player.calls.slice(native.player.calls.lastIndexOf('play')).includes('pause');
const tick = (currentTime: number, playing = true) => act(async () => {
  native.player.currentTime = currentTime;
  for (const listener of listeners) listener({ currentTime, playing });
});

describe('narration of a half-chapter day', () => {
  it('starts at the range\'s first verse and stops by itself after its last one, as the end of the passage', async () => {
    const scope = await mount({ first: 2, last: 3 });
    expect(scope).toHaveBeenLastCalledWith('range');
    await press();
    expect(native.player.calls.filter((c: string) => c.startsWith('seek') || c === 'play')).toEqual(['seek:9.5', 'play']);
    await tick(12);
    expect(pausedSincePlay()).toBe(false);
    await tick(20.1);
    expect(native.player.calls.at(-1)).toBe('pause');
    expect(context.onPlaybackEnded).toHaveBeenCalledTimes(1);
    expect(context.onPlaybackEnded).toHaveBeenCalledWith('PSA.119');
    expect((context.onPlayingVerse as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual(['PSA.119', null]);
    // Later ticks of the stopped player change nothing; play again reads the range again.
    await tick(20.1, false);
    expect(context.onPlaybackEnded).toHaveBeenCalledTimes(1);
    await press();
    expect(native.player.calls.slice(-2)).toEqual(['seek:9.5', 'play']);
  });

  it('stops on the last verse\'s end, not on the next status tick', async () => {
    await mount({ first: 2, last: 3 });
    await press();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await tick(19.5);
    expect(pausedSincePlay()).toBe(false);
    await act(async () => { vi.advanceTimersByTime(490); });
    expect(pausedSincePlay()).toBe(false);
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(native.player.calls.at(-1)).toBe('pause');
    expect(context.onPlaybackEnded).toHaveBeenCalledTimes(1);
  });

  it('resumes a pause inside the range where it was', async () => {
    await mount({ first: 2, last: 3 });
    await press();
    await tick(12);
    await press(); // pause
    await tick(12, false);
    const seeks = native.player.calls.filter((c: string) => c.startsWith('seek')).length;
    await press(); // play
    expect(native.player.calls.filter((c: string) => c.startsWith('seek')).length).toBe(seeks);
    expect(native.player.calls.at(-1)).toBe('play');
  });

  it('moves to the next range of the same chapter on the next play', async () => {
    const scope = await mount({ first: 2, last: 3 });
    await press();
    await tick(20.1);
    await act(async () => { view!.update(element({ first: 4, last: 4 }, scope)); });
    await press();
    expect(native.player.calls.slice(-2)).toEqual(['seek:20.4', 'play']);
    await tick(27);
    expect(context.onPlaybackEnded).toHaveBeenCalledTimes(1);
  });

  // Like a chapter change: moving to another passage of the same chapter (10/30 徒7:1-29 → 徒7:31-60) while
  // it is read stops the narration; 連讀's own move on from a finished range is not stopped.
  it('stops when the member moves to another range of the chapter while it is read, but not when 連讀 moves on', async () => {
    const scope = await mount({ first: 2, last: 3 });
    await press();
    await tick(12);
    await act(async () => { view!.update(element({ first: 4, last: 4 }, scope)); });
    expect(pausedSincePlay()).toBe(true);
    expect(context.onPlaybackPaused).toHaveBeenCalledWith('PSA.119');
    await press();
    expect(native.player.calls.slice(-2)).toEqual(['seek:20.4', 'play']);
    (context.onPlaybackPaused as ReturnType<typeof vi.fn>).mockClear();
    await tick(27);
    await act(async () => { view!.update(element({ first: 2, last: 3 }, scope)); });
    expect(context.onPlaybackPaused).toHaveBeenCalledTimes(1);
    await press();
    await tick(20.1);
    native.player.playing = true; // the native player may still report playing for a moment
    (context.onPlaybackPaused as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => { view!.update(element({ first: 4, last: 4 }, scope)); });
    expect(context.onPlaybackPaused).not.toHaveBeenCalled();
  });

  it('reads the whole chapter, and says so, when the recording has no per-verse timing', async () => {
    const scope = await mount({ first: 2, last: 3 }, null);
    expect(scope).toHaveBeenLastCalledWith('chapter');
    await press();
    expect(native.player.calls.filter((c: string) => c.startsWith('seek'))).toEqual([]);
    await tick(21);
    expect(pausedSincePlay()).toBe(false);
    expect(context.onPlaybackEnded).not.toHaveBeenCalled();
  });

  it('has nothing to say on a whole-chapter day', async () => {
    const scope = await mount(null, null);
    expect(scope).toHaveBeenLastCalledWith(null);
    await press();
    expect(native.player.calls.filter((c: string) => c.startsWith('seek'))).toEqual([]);
  });
});
