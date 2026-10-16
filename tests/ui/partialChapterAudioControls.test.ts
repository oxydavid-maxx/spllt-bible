import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
const native = vi.hoisted(() => ({ player: null as any, appState: 'active', visibility: new Set<(s: string) => void>() }));
vi.mock('react-native', () => ({ AppState: { get currentState() { return native.appState; }, addEventListener: (_: string, fn: (s: string) => void) => { native.visibility.add(fn); return { remove: () => native.visibility.delete(fn) }; } }, ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), StyleSheet: { create: (v: unknown) => v } }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: primitive('Icon') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => native.player }));
import { ChapterAudioControls, ChapterAudioAutoplayContext, type ChapterAudioAutoplayContextValue } from '../../src/ui/ChapterAudioControls';
import { parseAssignedVerseRange } from '../../src/domain/partialChapter';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

let view: TestRenderer.ReactTestRenderer | null = null;
let context: ChapterAudioAutoplayContextValue;
let fetchImpl: ReturnType<typeof vi.fn>;
let listeners: Set<(status: any) => void>;
const timing = [{ verse: 1, start: 2, end: 8 }, { verse: 2, start: 8, end: 14 }, { verse: 3, start: 14, end: 20 }, { verse: 4, start: 20, end: 28 }];
const payload = () => ({ identity: { versionId: 46, usfm: 'PSA.119' }, text: true, audio: true, offline: false, status: 'verified_source', reason: '', uri: 'https://audio.example.test/psa119.mp3', providerExpiry: null, validUntil: '2030-01-01T00:00:00Z', verseTiming: timing, provenance: { publisher: 'Fixture', edition: 'Fixture', recordingId: 'fixture', reference: 'PSA.119', attribution: 'Fixture' } });
const element = () => React.createElement(ChapterAudioAutoplayContext.Provider, { value: context }, React.createElement(ChapterAudioControls, { chapterUsfm: 'PSA.119', versionId: 46, env: { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' }, baseUrl: 'https://fixture.example.test', fetchImpl: fetchImpl as typeof fetch }));
async function mount() { await act(async () => { view = TestRenderer.create(element()); }); }
async function press() { await act(async () => { view!.root.findAll(n => String(n.type) === 'Pressable')[0].props.onPress(); }); }
async function tick(currentTime: number, extra = {}) { await act(async () => { native.player.currentTime = currentTime; for (const listener of [...listeners]) listener({ currentTime, playing: native.player.playing, ...extra }); }); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-16T00:00:00Z');
  native.appState = 'active'; native.visibility.clear(); listeners = new Set();
  setAuthSession({ memberId: 'fixture:partial', sessionToken: 'synthetic-partial' });
  const p: any = { currentTime: 0, duration: 28, playing: false, isLoaded: true, isBuffering: false, calls: [] as string[],
    play() { p.playing = true; p.calls.push('play'); }, pause() { p.playing = false; p.calls.push('pause'); },
    replace() { p.currentTime = 0; p.playing = false; p.calls.push('replace'); },
    seekTo: vi.fn(async (seconds: number) => { p.currentTime = seconds; p.calls.push(`seek:${seconds}`); }),
    setPlaybackRate() {}, remove() {}, addListener(_: string, listener: (status: any) => void) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
  }; native.player = p;
  fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload())));
  context = { available: true, enabled: true, intent: null, notice: null, cancel: vi.fn(), toggle: vi.fn(), onPlaybackStarted: vi.fn(), onPlaybackPaused: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(), onAutoplayUnavailable: vi.fn(), onPlayingVerse: vi.fn(),
    passageRange: parseAssignedVerseRange('PSA.119.2-3'), passageKey: '2026-10-15::PSA.119.2-3', onRangeAudioNotice: vi.fn() } as ChapterAudioAutoplayContextValue;
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = null; clearAuthSession(); vi.useRealTimers(); });

it('seeks to the assigned first verse before play, resumes pause, stops at the last end once, and replays the range', async () => {
  await mount(); await press();
  expect(native.player.calls.slice(-2)).toEqual(['seek:8', 'play']);
  expect(native.player.seekTo).toHaveBeenCalledWith(8, 0, 0);
  await tick(12); await press(); await tick(12); await press();
  expect(native.player.currentTime).toBe(12); expect(native.player.seekTo).toHaveBeenCalledTimes(1);
  await tick(19.99); expect(native.player.playing).toBe(true); expect(context.onPlaybackEnded).not.toHaveBeenCalled();
  await tick(20); expect(native.player.playing).toBe(false);
  await tick(20.4, { didJustFinish: true });
  expect(context.onPlaybackEnded).toHaveBeenCalledExactlyOnceWith('PSA.119');
  expect(context.onPlayingVerse).toHaveBeenLastCalledWith('PSA.119', null);
  await press(); expect(native.player.calls.slice(-2)).toEqual(['seek:8', 'play']);
  await tick(20); expect(context.onPlaybackEnded).toHaveBeenCalledTimes(2);
});
it('enforces the end while hidden without publishing an off-range highlight', async () => {
  await mount(); await press();
  await act(async () => { native.appState = 'background'; for (const fn of native.visibility) fn('background'); });
  await tick(20.2);
  expect(native.player.playing).toBe(false); expect(context.onPlaybackEnded).toHaveBeenCalledExactlyOnceWith('PSA.119');
  expect((context.onPlayingVerse as any).mock.calls.some(([, v]: any[]) => v === 4)).toBe(false);
});
it('date/range changes on the same chapter cancel the old binding and start the new range', async () => {
  await mount(); await press(); const old = [...listeners][0];
  context = { ...context, passageRange: parseAssignedVerseRange('PSA.119.1-2'), passageKey: '2026-10-16::PSA.119.1-2' } as any;
  await act(async () => view!.update(element()));
  expect(native.player.playing).toBe(false);
  await act(async () => old({ currentTime: 20, didJustFinish: true })); expect(context.onPlaybackEnded).not.toHaveBeenCalled();
  await press(); expect(native.player.calls.slice(-2)).toEqual(['seek:2', 'play']);
});
it('unsegmented audio plays the chapter and reports the explanation through the reader context', async () => {
  fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ ...payload(), verseTiming: [] })));
  await mount(); await press();
  expect(native.player.seekTo).not.toHaveBeenCalled();
  expect((context as any).onRangeAudioNotice).toHaveBeenCalledWith('2026-10-15::PSA.119.2-3', '這段錄音沒有分節，會從頭播整章');
  await tick(20); expect(native.player.playing).toBe(true); expect(context.onPlaybackEnded).not.toHaveBeenCalled();
  await tick(28, { didJustFinish: true }); expect(context.onPlaybackEnded).toHaveBeenCalledOnce();
});
it('a pending seek cannot start playback after the assigned range changes', async () => {
  await mount(); let release!: () => void;
  native.player.seekTo.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  await press(); expect(release).toBeTypeOf('function');
  context = { ...context, passageRange: parseAssignedVerseRange('PSA.119.1-2'), passageKey: 'new-day' } as any;
  await act(async () => view!.update(element()));
  await act(async () => release()); expect(native.player.playing).toBe(false);
});
it('stops a media-card resume beyond the range without dispatching a second EOF', async () => {
  await mount(); await press(); await tick(20);
  native.player.playing = true; await tick(21);
  expect(native.player.playing).toBe(false);
  expect(context.onPlaybackEnded).toHaveBeenCalledOnce();
});
