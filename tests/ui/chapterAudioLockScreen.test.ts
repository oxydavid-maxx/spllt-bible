import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
vi.mock('react-native', () => ({ ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: primitive('Icon') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
const native = vi.hoisted(() => ({ player: null as any }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => native.player }));
import { ChapterAudioControls } from '../../src/ui/ChapterAudioControls';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';
import { setChapterAudioArtwork } from '../../src/services/chapterAudioBackground';

// 光佑 2026-09-28 (mock jhuke-audio-bg-mock-0928): while a chapter is being read, the notification shade
// and the lock screen carry a 竹科聖經 media card, and that card is also what lets Android keep the
// reading going in the background for longer than about three minutes.

const ICON = 'file:///data/user/0/org.qingmu.youth/cache/ExponentAsset-icon.png';
const SEEK = { showSeekBackward: true, showSeekForward: true };
const env = { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' };
const payload = (usfm: string, audio = true) => ({ identity: { versionId: 46, usfm }, text: true, audio, offline: false,
  status: audio ? 'verified_source' : 'explicit_no_audio', reason: '', uri: audio ? `https://example.test/${usfm}.mp3` : undefined, providerExpiry: null,
  validUntil: new Date(Date.now() + 300_000).toISOString(),
  provenance: { publisher: 'Test publisher', edition: 'Test edition', recordingId: 'test-source', reference: usfm, attribution: 'Test attribution' } });
const response = (body: unknown) => new Response(JSON.stringify(body));

let view: TestRenderer.ReactTestRenderer | null = null;
let fetchImpl: ReturnType<typeof vi.fn>;
let silent: Set<string>;

const element = (chapterUsfm: string, sharedOwner = true) => React.createElement(ChapterAudioControls, {
  chapterUsfm, versionId: 46, env, baseUrl: 'https://in-memory.test', fetchImpl: fetchImpl as typeof fetch, readerAction: true, sharedOwner,
} as never);
const settle = () => act(async () => { for (let step = 0; step < 6; step += 1) await Promise.resolve(); });
async function mount(chapterUsfm = 'JHN.3', sharedOwner = true) {
  await act(async () => { view = TestRenderer.create(element(chapterUsfm, sharedOwner)); });
  await settle();
}
async function show(chapterUsfm: string) { await act(async () => { view!.update(element(chapterUsfm)); }); await settle(); }
async function press() { await act(async () => { view!.root.findAll(node => String(node.type) === 'Pressable')[0].props.onPress(); }); await settle(); }

beforeEach(() => {
  setAuthSession({ memberId: 'test:A', sessionToken: 'synthetic-session-A' });
  setChapterAudioArtwork(Promise.resolve(ICON));
  silent = new Set();
  fetchImpl = vi.fn(async (url: string) => {
    const usfm = new URL(url).searchParams.get('usfm')!;
    return response(payload(usfm, !silent.has(usfm)));
  });
  const listeners = new Set<(status: any) => void>();
  const p: any = { currentTime: 0, duration: 120, playing: false, isLoaded: true, isBuffering: false, calls: [] as string[], card: [] as unknown[],
    // The real player reports every play/pause through playbackStatusUpdate; the control's label follows it.
    tick() { for (const listener of listeners) listener({ playing: p.playing, currentTime: p.currentTime }); },
    play() { p.calls.push('play'); p.playing = true; p.tick(); }, pause() { p.calls.push('pause'); p.playing = false; p.tick(); },
    replace(source: { uri: string }) { p.calls.push(`replace:${source.uri}`); p.currentTime = 0; p.playing = false; },
    async seekTo(seconds: number) { p.currentTime = seconds; }, setPlaybackRate() {}, remove() {},
    addListener(_event: string, listener: (status: any) => void) { listeners.add(listener); return { remove() { listeners.delete(listener); } }; },
    setActiveForLockScreen(active: boolean, metadata?: unknown, options?: unknown) { p.card.push(active ? ['show', metadata, options] : ['hide']); },
    updateLockScreenMetadata(metadata: unknown) { p.card.push(['update', metadata]); },
  };
  native.player = p;
});
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = null; clearAuthSession(); });

describe('the system media card for chapter narration', () => {
  it('appears when a chapter starts: its name, the version and 竹科聖經, the app icon, and step back/forward', async () => {
    await mount('JHN.3');
    expect(native.player.card).toEqual([]); // an open reader that is not reading has no card
    await press();
    expect(native.player.calls).toContain('play');
    expect(native.player.card).toEqual([
      ['show', { title: '約翰福音 3 章', artist: '和合本（神版，繁體） · 竹科聖經', artworkUrl: ICON }, SEEK],
    ]);
  });

  it('stays after a pause, so the reading can be resumed from the shade or the lock screen', async () => {
    await mount('JHN.3');
    await press();
    await press();
    expect(native.player.calls.at(-1)).toBe('pause');
    expect(native.player.card).toEqual([['show', expect.objectContaining({ title: '約翰福音 3 章' }), SEEK]]);
  });

  it('follows the next chapter by updating the same card, which needs no foreground (auto-advance while locked)', async () => {
    await mount('PSA.22');
    await press();
    await show('PSA.23');
    expect(native.player.calls).toContain('replace:https://example.test/PSA.23.mp3');
    expect(native.player.card).toEqual([
      ['show', { title: '詩篇 22 篇', artist: '和合本（神版，繁體） · 竹科聖經', artworkUrl: ICON }, SEEK],
      ['update', { title: '詩篇 23 篇', artist: '和合本（神版，繁體） · 竹科聖經', artworkUrl: ICON }],
    ]);
  });

  it('goes away when the member signs out', async () => {
    await mount('JHN.3');
    await press();
    await act(async () => { clearAuthSession(); });
    await settle();
    expect(native.player.card.at(-1)).toEqual(['hide']);
  });

  it('goes away with the Reader that owns the player', async () => {
    await mount('JHN.3');
    await press();
    await act(async () => { view!.unmount(); });
    view = null;
    expect(native.player.card.at(-1)).toEqual(['hide']);
  });

  it('goes away on a chapter without narration instead of offering the previous chapter from the shade', async () => {
    silent.add('JHN.4');
    await mount('JHN.3');
    await press();
    await show('JHN.4');
    expect(native.player.card).toEqual([['show', expect.objectContaining({ title: '約翰福音 3 章' }), SEEK], ['hide']]);
  });

  it('is driven only by the shared Reader owner, so two surfaces never fight over one system card', async () => {
    await mount('JHN.3', false);
    await press();
    expect(native.player.calls).toContain('play');
    expect(native.player.card).toEqual([]);
  });
});
