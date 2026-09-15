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

  it('keeps the compact toggle independent from playback', async () => {
    const toggle = vi.fn();
    await mount(vi.fn(), {
      available: true, enabled: true, intent: null, notice: null, cancel: vi.fn(), toggle,
      onPlaybackStarted: vi.fn(), onPlaybackPaused: vi.fn(), onPlaybackEnded: vi.fn(),
      onPlaybackError: vi.fn(), onAutoplayUnavailable: vi.fn(),
    }, true);
    const switchControl = view!.root.findAll(node => node.props?.accessibilityRole === 'switch')[0];
    expect(switchControl.props.accessibilityLabel).toBe('連續播放');
    expect(switchControl.props.accessibilityState).toMatchObject({ checked: true });
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
