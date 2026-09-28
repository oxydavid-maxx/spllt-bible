import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
const native = vi.hoisted(() => ({ player: null as any, appState: 'active', appStateListeners: new Set<(state: string) => void>() }));
vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), StyleSheet: { create: (value: unknown) => value },
  AppState: {
    get currentState() { return native.appState; },
    addEventListener: (_event: string, listener: (state: string) => void) => { native.appStateListeners.add(listener); return { remove: () => { native.appStateListeners.delete(listener); } }; },
  },
}));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: primitive('Icon') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => native.player }));
import { ChapterAudioControls, ChapterAudioAutoplayContext, type ChapterAudioAutoplayContextValue } from '../../src/ui/ChapterAudioControls';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';
import { setChapterAudioArtwork } from '../../src/services/chapterAudioBackground';

// 光佑 2026-09-28, device run of the background-audio build: with the screen off the app process sat at
// about 28% of a core while narration played. Every 500 ms status tick read five native properties
// (each a blocking hop to the main thread in expo-audio) and re-rendered the controls, and every verse
// change repainted the reader's WebView highlight - all for a screen nobody could see. While the app is
// in the background only what the phone still shows or needs is kept: the chapter hand-off at EOF (and
// with it the lock-screen card), errors, and pause/play from the card. One resync on return.

const env = { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' };
const payload = (usfm: string) => ({ identity: { versionId: 46, usfm }, text: true, audio: true, offline: false,
  status: 'verified_source', reason: '', uri: `https://example.test/${usfm}.mp3`, providerExpiry: null,
  validUntil: new Date(Date.now() + 300_000).toISOString(),
  verseTiming: [{ verse: 1, start: 0, end: 10 }, { verse: 2, start: 10, end: 20 }, { verse: 3, start: 20, end: 30 }, { verse: 4, start: 30, end: 120 }],
  provenance: { publisher: 'Test publisher', edition: 'Test edition', recordingId: 'test-source', reference: usfm, attribution: 'Test attribution' } });

let view: TestRenderer.ReactTestRenderer | null = null;
let fetchImpl: ReturnType<typeof vi.fn>;
let commits = 0;
let context: ChapterAudioAutoplayContextValue;

const element = (chapterUsfm: string) => React.createElement(React.Profiler, { id: 'controls', onRender: () => { commits += 1; } },
  React.createElement(ChapterAudioAutoplayContext.Provider, { value: context },
    React.createElement(ChapterAudioControls, { chapterUsfm, versionId: 46, env, baseUrl: 'https://in-memory.test', fetchImpl: fetchImpl as typeof fetch, readerAction: true, sharedOwner: true } as never)));
const settle = () => act(async () => { for (let step = 0; step < 6; step += 1) await Promise.resolve(); });
async function mount(chapterUsfm = 'JHN.3') { await act(async () => { view = TestRenderer.create(element(chapterUsfm)); }); await settle(); }
async function show(chapterUsfm: string) { await act(async () => { view!.update(element(chapterUsfm)); }); await settle(); }
const control = () => view!.root.findAll(node => String(node.type) === 'Pressable')[0];
async function press() { await act(async () => { control().props.onPress(); }); await settle(); }
async function appState(state: string) { native.appState = state; await act(async () => { for (const listener of [...native.appStateListeners]) listener(state); }); await settle(); }
async function tick(currentTime: number) { await act(async () => { native.player.position = currentTime; native.player.emit({ currentTime, playing: native.player.state, isLoaded: true }); }); }

beforeEach(() => {
  setAuthSession({ memberId: 'test:A', sessionToken: 'synthetic-session-A' });
  setChapterAudioArtwork(Promise.resolve(undefined));
  native.appState = 'active';
  native.appStateListeners.clear();
  commits = 0;
  fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(payload(new URL(url).searchParams.get('usfm')!))));
  context = {
    available: true, enabled: true, intent: null, notice: null, cancel: vi.fn(), toggle: vi.fn(),
    onPlaybackStarted: vi.fn(), onPlaybackPaused: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(), onAutoplayUnavailable: vi.fn(), onPlayingVerse: vi.fn(),
  };
  const listeners = new Set<(status: any) => void>();
  // Every property read below is, on the phone, a blocking JS -> main thread call into expo-audio.
  const p: any = { position: 0, state: false, reads: 0, calls: [] as string[], card: [] as unknown[],
    get currentTime() { p.reads += 1; return p.position; }, get duration() { p.reads += 1; return 120; },
    get playing() { p.reads += 1; return p.state; }, get isLoaded() { p.reads += 1; return true; }, get isBuffering() { p.reads += 1; return false; },
    emit(status: unknown) { for (const listener of [...listeners]) listener(status); },
    play() { p.calls.push('play'); p.state = true; p.emit({ playing: true, currentTime: p.position }); },
    pause() { p.calls.push('pause'); p.state = false; p.emit({ playing: false, currentTime: p.position }); },
    replace(source: { uri: string }) { p.calls.push(`replace:${source.uri}`); p.position = 0; p.state = false; },
    async seekTo(seconds: number) { p.position = seconds; }, setPlaybackRate() {}, remove() {},
    addListener(_event: string, listener: (status: any) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; },
    setActiveForLockScreen(active: boolean, metadata?: { title?: string }) { p.card.push(active ? ['show', metadata?.title] : ['hide']); },
    updateLockScreenMetadata(metadata: { title?: string }) { p.card.push(['update', metadata.title]); },
  };
  native.player = p;
});
afterEach(async () => { vi.useRealTimers(); if (view) await act(async () => view!.unmount()); view = null; clearAuthSession(); });

describe('chapter narration with the app in the background', () => {
  it('does no per-tick work nobody can see, and resyncs position, verse and play state once on return', async () => {
    await mount('JHN.3');
    await press();
    await tick(12);
    expect(context.onPlayingVerse).toHaveBeenLastCalledWith('JHN.3', 2);
    expect(control().props.accessibilityLabel).toBe('暫停JHN.3語音');

    vi.useFakeTimers();
    await appState('background');
    native.player.reads = 0;
    commits = 0;
    vi.mocked(context.onPlayingVerse!).mockClear();
    for (let second = 13; second <= 60; second += 0.5) await tick(second);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    // The member paused from the lock-screen card; the status stream reports it like any other tick.
    await act(async () => { native.player.state = false; native.player.emit({ playing: false, currentTime: 60 }); });
    expect(native.player.reads).toBe(0);
    expect(commits).toBe(0);
    expect(context.onPlayingVerse).not.toHaveBeenCalled();

    await appState('active');
    expect(context.onPlayingVerse).toHaveBeenCalledExactlyOnceWith('JHN.3', 4);
    expect(control().props.accessibilityLabel).toBe('播放JHN.3語音');
  });

  it('still hands the finished chapter to 連讀 and moves the lock-screen card on, with the screen off', async () => {
    await mount('PSA.103');
    await press();
    await appState('background');
    await act(async () => { native.player.state = false; native.player.emit({ didJustFinish: true, playing: false }); });
    expect(context.onPlaybackEnded).toHaveBeenCalledExactlyOnceWith('PSA.103');
    await show('PSA.104');
    expect(native.player.calls).toContain('replace:https://example.test/PSA.104.mp3');
    expect(native.player.card).toEqual([['show', '詩篇 103 篇'], ['update', '詩篇 104 篇']]);
  });

  it('reports a playback error that happens in the background', async () => {
    await mount('JHN.3');
    await press();
    await appState('background');
    await act(async () => { native.player.emit({ error: 'network' }); });
    await settle();
    expect(context.onPlaybackError).toHaveBeenCalledWith('JHN.3');
    await appState('active');
    expect(control().props.accessibilityLabel).toBe('重試JHN.3語音');
  });
});
