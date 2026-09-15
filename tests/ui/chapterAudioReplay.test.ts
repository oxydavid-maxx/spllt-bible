import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
vi.mock('react-native', () => ({ ActivityIndicator: primitive('ActivityIndicator'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
const native = vi.hoisted(() => ({ player: null as any }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => native.player }));
import { ChapterAudioControls } from '../../src/ui/ChapterAudioControls';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

let view: TestRenderer.ReactTestRenderer | null;
let fetchImpl: ReturnType<typeof vi.fn>;
const env = { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' };
const payload = (usfm = '1TI.1', uri = `https://example.test/${usfm}.mp3`) => ({ identity: { versionId: 46, usfm }, text: true, audio: true, offline: false, status: 'verified_source', reason: '', uri, providerExpiry: null, validUntil: new Date(Date.now() + 300_000).toISOString(), provenance: { publisher: 'Test publisher', edition: 'Test edition', recordingId: 'test-source', reference: usfm, attribution: 'Test attribution' } });
const response = (body: unknown) => new Response(JSON.stringify(body));
const props = (chapterUsfm = '1TI.1', onPlaybackStarted?: (chapterUsfm: string) => void) => ({ chapterUsfm, versionId: 46, env, baseUrl: 'https://in-memory.test', fetchImpl: fetchImpl as typeof fetch, onPlaybackStarted });
async function mount(onPlaybackStarted?: (chapterUsfm: string) => void) { await act(async () => { view = TestRenderer.create(React.createElement(ChapterAudioControls, props('1TI.1', onPlaybackStarted))); }); }
const button = () => view!.root.findAll(node => String(node.type) === 'Pressable')[0];
const text = () => view!.root.findAll(node => String(node.type) === 'Text').map(node => String(node.props.children)).join(' ');
async function press() { await act(async () => { button().props.onPress(); }); }
async function expire() { await act(async () => { await vi.advanceTimersByTimeAsync(301_000); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime('2026-09-13T10:00:00Z'); view = null;
  setAuthSession({ memberId: 'test:A', sessionToken: 'synthetic-session-A' });
  const listeners = new Set<(status: any) => void>();
  const p: any = { currentTime: 0, duration: 199, playing: false, isLoaded: true, isBuffering: false, calls: [] as string[],
    play() { if (p.currentTime >= p.duration) throw new Error('END_REQUIRES_SEEK'); p.calls.push('play'); p.playing = true; },
    pause() { p.calls.push('pause'); p.playing = false; },
    replace(source: { uri: string }) { p.calls.push(`replace:${source.uri}`); p.currentTime = 0; p.playing = false; p.isLoaded = true; },
    async seekTo(seconds: number) { p.calls.push(`seek:${seconds}`); p.currentTime = seconds; },
    setPlaybackRate() {}, remove() { p.calls.push('remove'); },
    addListener(_event: string, listener: (status: any) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; },
    finish() { p.currentTime = 198.999; p.playing = false; p.isLoaded = false; for (const listener of listeners) listener({ didJustFinish: true, playing: false, isLoaded: true }); },
  };
  native.player = p;
  fetchImpl = vi.fn(async (url: string) => response(payload(new URL(url).searchParams.get('usfm')!)));
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); clearAuthSession(); vi.useRealTimers(); });

describe('single play intent after capability expiry and native EOF', () => {
  it('refreshes an expired capability automatically and resumes same URI at the paused position', async () => {
    await mount(); native.player.currentTime = 37; await expire(); await press();
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(native.player.playing).toBe(true); expect(native.player.currentTime).toBe(37);
    expect(native.player.calls.filter((call: string) => call.startsWith('replace:'))).toHaveLength(1);
    expect(text()).not.toContain('失敗');
  });
  it('prepares a changed URI before automatically fulfilling the original play intent', async () => {
    await mount(); native.player.currentTime = 37; await expire();
    fetchImpl.mockImplementationOnce(async () => response(payload('1TI.1', 'https://example.test/new.mp3')));
    await press(); expect(native.player.calls.slice(-2)).toEqual(['replace:https://example.test/new.mp3', 'play']);
    expect(native.player.currentTime).toBe(0); expect(native.player.playing).toBe(true);
  });
  it('reports a changed-URI refresh as a started playback so continuous mode can arm', async () => {
    const started = vi.fn();
    await mount(started); native.player.currentTime = 37; await expire();
    fetchImpl.mockImplementationOnce(async () => response(payload('1TI.1', 'https://example.test/new.mp3')));
    await press();
    expect(started).toHaveBeenCalledWith('1TI.1');
  });
  it.each(['explicit_no_audio', 'temporarily_unavailable'])('shows the genuine refreshed %s state without playing the stale source', async status => {
    await mount(); await expire(); fetchImpl.mockImplementationOnce(async () => response({ identity: { versionId: 46, usfm: '1TI.1' }, text: true, audio: false, offline: false, status }));
    await press(); expect(fetchImpl).toHaveBeenCalledTimes(2); expect(native.player.playing).toBe(false);
    const labels = view!.root.findAll(node => Boolean(node.props.accessibilityLabel)).map(node => String(node.props.accessibilityLabel));
    expect(labels.some(label => status === 'explicit_no_audio' ? label.includes('沒有朗讀') : label.includes('重試'))).toBe(true); expect(text()).not.toContain('播放失敗');
    expect(view!.root.findAll(node => String(node.type) === 'Pressable')).toHaveLength(status === 'explicit_no_audio' ? 0 : 1);
  });
  it('recovers from a failed refresh through the existing retry and prepares a fresh capability', async () => {
    await mount(); native.player.currentTime = 37; await expire();
    fetchImpl.mockRejectedValueOnce(new Error('private transport detail'));
    await press(); expect(native.player.playing).toBe(false);
    expect(button().props.accessibilityLabel).toContain('重試');
    expect(text()).not.toContain('private transport detail');
    expect(view!.root.findAll(node => Boolean(node.props.accessibilityLabel)).map(node => String(node.props.accessibilityLabel)).join(' ')).not.toContain('private transport detail');
    await press(); expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(native.player.calls.slice(-2)).toEqual(['replace:https://example.test/1TI.1.mp3', 'play']);
    expect(native.player.currentTime).toBe(0); expect(text()).not.toContain('播放失敗');
  });
  it('pause remains available after capability expiry without a new query', async () => {
    await mount(); await press(); await expire(); await press();
    expect(native.player.playing).toBe(false); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(['chapter', 'account'])('a late refresh cannot auto-play after the %s changes', async transition => {
    await mount(); await expire(); let release!: (value: Response) => void;
    fetchImpl.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    await press(); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await act(async () => { if (transition === 'chapter') view!.update(React.createElement(ChapterAudioControls, props('1TI.2'))); else setAuthSession({ memberId: 'test:B', sessionToken: 'synthetic-session-B' }); });
    const before = [...native.player.calls];
    expect(release).toBeTypeOf('function'); await act(async () => { release(response(payload())); });
    expect(native.player.calls).toEqual(before); expect(native.player.playing).toBe(false);
  });
  it('coalesces repeated play taps while the same refresh is pending', async () => {
    await mount(); await expire(); let release!: (value: Response) => void;
    fetchImpl.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    await press(); expect(fetchImpl).toHaveBeenCalledTimes(2); await press(); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await act(async () => { release(response(payload())); });
    expect(native.player.calls.filter((call: string) => call === 'play')).toHaveLength(1);
  });
  it('restarts a finished recording from zero even though the native loaded getter is false', async () => {
    await mount(); await press(); await act(async () => { native.player.finish(); await vi.advanceTimersByTimeAsync(500); });
    await press(); expect(native.player.calls.slice(-2)).toEqual(['seek:0', 'play']); expect(native.player.currentTime).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(text()).not.toContain('失敗');
  });
  it('combines expired source confirmation with EOF rewind in a single tap', async () => {
    await mount(); await press(); await act(async () => native.player.finish()); await expire(); await press();
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(native.player.calls.slice(-2)).toEqual(['seek:0', 'play']);
  });
  it('does not mistake an ordinary paused position or loaded=false for EOF', async () => {
    await mount(); native.player.currentTime = 42; native.player.isLoaded = false; await press();
    expect(native.player.currentTime).toBe(42); expect(native.player.calls).not.toContain('seek:0');
  });
  it.each(['chapter', 'account', 'unmount'])('rechecks ownership after an asynchronous EOF seek and %s transition before calling play', async transition => {
    await mount(); await act(async () => { native.player.finish(); await vi.advanceTimersByTimeAsync(500); });
    let release!: () => void; native.player.seekTo = async (seconds: number) => { native.player.currentTime = seconds; await new Promise<void>(resolve => { release = resolve; }); };
    await press(); await act(async () => {
      if (transition === 'chapter') view!.update(React.createElement(ChapterAudioControls, props('1TI.2')));
      else if (transition === 'account') setAuthSession({ memberId: 'test:B', sessionToken: 'synthetic-session-B' });
      else { view!.unmount(); view = null; }
    });
    const plays = native.player.calls.filter((call: string) => call === 'play').length;
    expect(release).toBeTypeOf('function'); await act(async () => release());
    expect(native.player.calls.filter((call: string) => call === 'play')).toHaveLength(plays);
  });
});
