import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
const native = vi.hoisted(() => ({ player: null as any }));
vi.mock('react-native', () => ({ ActivityIndicator: primitive('ActivityIndicator'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => native.player }));

import { ChapterAudioAutoplayNotice, ChapterAudioAutoplayToggle, ChapterAudioControls, ChapterAudioAutoplayContext, type ChapterAudioAutoplayContextValue } from '../../src/ui/ChapterAudioControls';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

const response = (body: unknown) => new Response(JSON.stringify(body));
const payload = {
  identity: { versionId: 46, usfm: '1TI.1' }, text: true, audio: true, offline: false,
  status: 'verified_source', reason: '', uri: 'https://example.test/1TI.1.mp3', providerExpiry: null,
  validUntil: new Date('2030-01-01T00:00:00Z').toISOString(),
  provenance: { publisher: 'Test', edition: 'Test', recordingId: 'test', reference: '1TI.1', attribution: 'Test' },
};

let view: TestRenderer.ReactTestRenderer | null = null;
let fetchImpl: ReturnType<typeof vi.fn>;
let listeners: Set<(status: any) => void>;

beforeEach(() => {
  setAuthSession({ memberId: 'A', sessionToken: 'session-A' });
  fetchImpl = vi.fn(async () => response(payload));
  listeners = new Set();
  const p: any = {
    currentTime: 0, duration: 100, playing: false, isLoaded: true, isBuffering: false, calls: [],
    play() { p.playing = true; p.calls.push('play'); }, pause() { p.playing = false; p.calls.push('pause'); },
    replace(source: { uri: string }) { p.calls.push(`replace:${source.uri}`); }, seekTo: async (value: number) => { p.currentTime = value; },
    setPlaybackRate() {}, remove() {}, addListener(_event: string, listener: (status: any) => void) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
    finish() { p.playing = false; p.currentTime = 100; for (const listener of listeners) listener({ didJustFinish: true }); for (const listener of listeners) listener({ didJustFinish: true }); },
  };
  native.player = p;
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = null; clearAuthSession(); });

const mount = async (onPlaybackEnded: ReturnType<typeof vi.fn>, context?: ChapterAudioAutoplayContextValue, includeToggle = false) => {
  await act(async () => {
    const control = React.createElement(ChapterAudioControls, {
      chapterUsfm: '1TI.1', versionId: 46, env: { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' },
      baseUrl: 'https://in-memory.test', fetchImpl: fetchImpl as typeof fetch,
      onPlaybackEnded,
    } as never);
    const content = includeToggle ? React.createElement(React.Fragment, null, control, React.createElement(ChapterAudioAutoplayToggle)) : control;
    view = TestRenderer.create(context
      ? React.createElement(ChapterAudioAutoplayContext.Provider, { value: context }, content)
      : content);
  });
};

describe('ChapterAudioControls reading highlight', () => {
  it('reports the narrated verse once per change from status ticks, and clears it at EOF and on teardown', async () => {
    fetchImpl.mockImplementation(async () => response({ ...payload, verseTiming: [{ verse: 1, start: 2.9, end: 9.5 }, { verse: 2, start: 9.5, end: 14 }] }));
    const onPlayingVerse = vi.fn();
    const context: ChapterAudioAutoplayContextValue = {
      available: true, enabled: false, intent: null, notice: null, cancel: vi.fn(), toggle: vi.fn(),
      onPlaybackStarted: vi.fn(), onPlaybackPaused: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(), onAutoplayUnavailable: vi.fn(), onPlayingVerse,
    };
    await mount(vi.fn(), context);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const tick = (currentTime: number) => act(async () => { for (const listener of listeners) listener({ currentTime, playing: true }); });
    await tick(1.0);
    expect(onPlayingVerse).toHaveBeenCalledWith('1TI.1', null);
    await tick(3.0); await tick(3.5); await tick(9.0);
    expect(onPlayingVerse.mock.calls.filter(([, verse]) => verse === 1)).toHaveLength(1);
    await tick(9.5); await tick(10.0);
    expect(onPlayingVerse.mock.calls.map(([, verse]) => verse)).toEqual([null, 1, 2]);
    await act(async () => { native.player.finish(); });
    expect(onPlayingVerse.mock.calls.at(-1)).toEqual(['1TI.1', null]);
    const before = onPlayingVerse.mock.calls.length;
    await act(async () => view!.unmount()); view = null;
    expect(onPlayingVerse.mock.calls.length).toBe(before); // already null; teardown does not spam
  });
});

describe('ChapterAudioControls EOF handoff', () => {
  it('reports a real EOF once even if native status emits duplicate finish events', async () => {
    const ended = vi.fn();
    await mount(ended);
    await act(async () => { await Promise.resolve(); });
    const button = view!.root.findAll(node => String(node.type) === 'Pressable')[0];
    await act(async () => { button.props.onPress(); await Promise.resolve(); });
    await act(async () => { native.player.finish(); });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith('1TI.1');
  });

  it.each([true, false])('shows the current continuous-reading state (%s) independently from playback', async enabled => {
    const toggle = vi.fn();
    await mount(vi.fn(), {
      available: true, enabled, intent: null, notice: null, cancel: vi.fn(), toggle,
      onPlaybackStarted: vi.fn(), onPlaybackPaused: vi.fn(), onPlaybackEnded: vi.fn(),
      onPlaybackError: vi.fn(), onAutoplayUnavailable: vi.fn(),
    }, true);
    const switchControl = view!.root.findAll(node => node.props?.accessibilityRole === 'switch')[0];
    expect(switchControl.props.accessibilityLabel).toBe('連讀');
    expect(switchControl.props.accessibilityHint).toContain(enabled ? '目前開啟' : '目前關閉');
    expect(JSON.stringify(view!.toJSON())).toContain('連讀');
    expect(switchControl.props.accessibilityState).toMatchObject({ checked: enabled });
    expect(switchControl.findAll(node => String(node.type) === 'Text').map(node => String(node.props.children)).join('')).toBe('連讀');
    const track = switchControl.findAll(node => node.props?.testID === 'autoplay-track')[0];
    const knob = switchControl.findAll(node => node.props?.testID === 'autoplay-knob')[0];
    const flat = (style: unknown) => Object.assign({}, ...([] as unknown[]).concat(style as unknown[]).filter(Boolean));
    // System-switch semantics: green track + knob on the right = on; grey track + knob on the left = off.
    expect(flat(track.props.style).backgroundColor).toBe(enabled ? '#1A5544' : '#768D7E');
    expect(enabled ? flat(knob.props.style).right : flat(knob.props.style).left).toBe(2);
    expect(enabled ? flat(knob.props.style).left : flat(knob.props.style).right).toBeUndefined();
    expect(switchControl.props.style).toMatchObject({ minWidth: 48, minHeight: 48, flexShrink: 0 });
    expect(switchControl.props.style.position).toBeUndefined();
    expect(native.player.calls).not.toContain('play');
    await act(async () => switchControl.props.onPress());
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(native.player.calls).not.toContain('play');
  });

  it('routes a stable native listener to the latest reading sequence context', async () => {
    const first = { available: true, enabled: true, intent: null, notice: null, cancel: vi.fn(), toggle: vi.fn(), onPlaybackStarted: vi.fn(), onPlaybackPaused: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(), onAutoplayUnavailable: vi.fn() } satisfies ChapterAudioAutoplayContextValue;
    const latest = { ...first, onPlaybackEnded: vi.fn() } satisfies ChapterAudioAutoplayContextValue;
    await mount(vi.fn(), first);
    await act(async () => view!.update(React.createElement(ChapterAudioAutoplayContext.Provider, { value: latest }, React.createElement(ChapterAudioControls, {
      chapterUsfm: '1TI.1', versionId: 46, env: { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' },
      baseUrl: 'https://in-memory.test', fetchImpl: fetchImpl as typeof fetch,
    } as never))));
    await act(async () => { native.player.finish(); });
    expect(first.onPlaybackEnded).not.toHaveBeenCalled();
    expect(latest.onPlaybackEnded).toHaveBeenCalledTimes(1);
  });
});
