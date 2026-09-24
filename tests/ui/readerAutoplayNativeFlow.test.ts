import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED = 'true';
  process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false';
});
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
const native = vi.hoisted(() => ({ player: null as any }));
const boundary = vi.hoisted(() => ({ context: null as any }));

vi.mock('react-native', () => ({ ActivityIndicator: primitive('ActivityIndicator'), BackHandler: { addEventListener: () => ({ remove() {} }) }, Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), StyleSheet: { create: (value: unknown) => value }, Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View') }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView') }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: primitive('Icon') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => native.player }));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => ({
  status: 'READER_UI_READY', module: {
    YouVersionProvider: primitive('Provider'), BibleReaderSettingsSheet: primitive('SettingsSheet'),
    BibleChapterPickerSheet: primitive('ChapterSheet'), BibleVersionPickerSheet: primitive('VersionSheet'),
    BibleReader: primitive('Reader'), getReaderSettings: () => null, getDefaultReaderSettings: () => null,
    setReaderSettings: () => {}, subscribeReaderSettings: () => ({ remove() {} }),
  },
}) }) }));
vi.mock('../../src/ui/BibleContentPreloadHost', () => ({ BibleContentPreloadHost: () => null }));

import { ChapterAudioAutoplayNotice, ChapterAudioAutoplayToggle, ChapterAudioControls, useChapterAudioAutoplay } from '../../src/ui/ChapterAudioControls';
import { YouVersionReader } from '../../src/ui/YouVersionReader';
import { ReaderAudioBridgeButton } from '../../src/ui/ReaderAudioBridgeButton';
import type { CapabilityCoordinator, CapabilityOutcome } from '../../src/services/contentCapabilityClient';
import { clearAuthSession, setAuthSession } from '../../src/services/authSession';

const references = ['JHN.18', 'JHN.19', 'JHN.20'];
const playable = (usfm: string): CapabilityOutcome => ({
  kind: 'playable', identity: { versionId: 46, usfm }, capability: {
    identity: { versionId: 46, usfm }, text: true, audio: true, offline: false, status: 'verified_source', reason: '',
    uri: `https://example.test/${usfm}.mp3`, providerExpiry: null, validUntil: new Date('2030-01-01T00:00:00Z').toISOString(),
    provenance: { publisher: 'Test', edition: 'Test', recordingId: usfm, reference: usfm, attribution: 'Test' },
  },
});

let renderer: TestRenderer.ReactTestRenderer | null = null;
let index = 0;
let coordinator: CapabilityCoordinator;
let outcomeFor: (usfm: string) => CapabilityOutcome = playable;

function AudioFromReader({ chapterUsfm }: { chapterUsfm: string }) {
  const autoplay = useChapterAudioAutoplay();
  boundary.context = autoplay;
  const control = React.createElement(ChapterAudioControls, {
    chapterUsfm, versionId: 46, coordinator, env: { EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED: 'true' }, sharedOwner: true,
    onPlaybackStarted: () => {},
    // Keep a probe in the same provider so the test can inspect the user-visible notice.
    children: undefined,
    'data-autoplay-notice': autoplay.notice,
  } as never);
  return React.createElement(React.Fragment, null, control, React.createElement(ChapterAudioAutoplayToggle), React.createElement(ChapterAudioAutoplayNotice), React.createElement(ReaderAudioBridgeButton));
}

function Harness({ routeReferences = references, book, chapter, uncontrolled = false }: { routeReferences?: string[]; book?: string; chapter?: string; uncontrolled?: boolean }) {
  const [activeIndex, setActiveIndex] = React.useState(index);
  const assignedReference = routeReferences[activeIndex] ?? '';
  const [assignedBook, assignedChapter] = assignedReference.split('.');
  const visibleBook = book ?? assignedBook;
  const visibleChapter = chapter ?? assignedChapter;
  return React.createElement(YouVersionReader, {
    date: '2026-09-12', references: routeReferences, appKey: 'test', versionId: 46,
    ...(uncontrolled ? {} : { book: visibleBook, chapter: visibleChapter }), allowTechnicalProbe: true,
    fullscreen: true, activeReferenceIndex: activeIndex, onActiveReferenceChange: next => { index = next; setActiveIndex(next); },
    renderScreen: () => React.createElement(AudioFromReader, { chapterUsfm: visibleBook && visibleChapter ? `${visibleBook}.${visibleChapter}` : routeReferences[activeIndex] }),
  });
}

beforeEach(() => {
  index = 0; outcomeFor = playable; setAuthSession({ memberId: 'A', sessionToken: 'session-A' });
  const listeners = new Set<(status: any) => void>();
  const p: any = { currentTime: 0, duration: 100, playing: false, isLoaded: true, isBuffering: false, calls: [],
    play() { p.playing = true; p.calls.push('play'); }, pause() { p.playing = false; p.calls.push('pause'); },
    replace(source: { uri: string }) { p.currentTime = 0; p.playing = false; p.isLoaded = true; p.calls.push(`replace:${source.uri}`); },
    seekTo: async (seconds: number) => { p.currentTime = seconds; p.calls.push(`seek:${seconds}`); }, setPlaybackRate() {}, remove() {},
    addListener(_event: string, listener: (status: any) => void) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
    finish() { p.currentTime = p.duration; p.playing = false; p.isLoaded = false; for (const listener of listeners) listener({ didJustFinish: true }); },
    fail() { for (const listener of listeners) listener({ error: 'network' }); },
  };
  native.player = p;
  coordinator = { generation: () => 0, cancel: () => {}, request: async (identity) => outcomeFor(identity.usfm) };
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null; clearAuthSession(); });

async function mount(routeReferences = references, uncontrolled = false) {
  await act(async () => { renderer = TestRenderer.create(React.createElement(Harness, { routeReferences, uncontrolled })); await Promise.resolve(); });
}
const audioButton = () => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'button' && String(node.props.accessibilityLabel).startsWith('播放'))[0];

describe('Reader continuous playback through the real chapter control', () => {
  it('keeps the legacy uncontrolled Reader mode advancing its assigned references', async () => {
    await mount(['TIT.1', 'TIT.2'], true);
    await act(async () => { audioButton().props.onPress(); await Promise.resolve(); });
    expect(native.player.calls).toContain('play');
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    expect(index).toBe(1);
    expect(native.player.calls).toContain('replace:https://example.test/TIT.2.mp3');
  });

  it('uses the shared Diary command against the mounted Reader player', async () => {
    await mount();
    const audioOwners = renderer!.root.findAll(node => typeof node.props?.accessibilityLabel === 'string'
      && String(node.type) === 'View' && (node.props.accessibilityLabel as string).startsWith('章節語音'));
    expect(audioOwners).toHaveLength(1);
    const playInDiary = renderer!.root.findAll(node => node.props?.accessibilityLabel === '播放朗讀' && typeof node.props?.onPress === 'function')[0];
    expect(playInDiary).toBeDefined();
    await act(async () => { playInDiary.props.onPress(); await Promise.resolve(); });
    expect(native.player.calls).toContain('play');
    expect(renderer!.root.findAll(node => typeof node.props?.accessibilityLabel === 'string'
      && String(node.type) === 'View' && (node.props.accessibilityLabel as string).startsWith('章節語音'))).toHaveLength(1);
  });

  it('moves to the next visible reference and uses the same player for the next source', async () => {
    await mount();
    await act(async () => { audioButton().props.onPress(); await Promise.resolve(); });
    expect(native.player.calls).toContain('play');
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    expect(index).toBe(1);
    expect(native.player.calls).toContain('replace:https://example.test/JHN.19.mp3');
    expect(native.player.calls.filter((call: string) => call === 'play')).toHaveLength(2);
  });

  it('keeps the current chapter playing at its position when continuous playback is turned off', async () => {
    await mount();
    await act(async () => { audioButton().props.onPress(); await Promise.resolve(); });
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    expect(index).toBe(1);
    native.player.currentTime = 27;
    native.player.playing = true;
    const toggle = renderer!.root.findAll(node => node.props?.accessibilityRole === 'switch')[0];
    await act(async () => toggle.props.onPress());
    expect(boundary.context.enabled).toBe(false);
    expect(native.player.currentTime).toBe(27);
    expect(native.player.playing).toBe(true);
    native.player.currentTime = 28;
    await act(async () => { await Promise.resolve(); });
    expect(native.player.currentTime).toBe(28);
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    expect(index).toBe(1);
    expect(native.player.playing).toBe(false);
  });

  it('re-arms the next EOF when enabled again during the same playing chapter without restarting it', async () => {
    await mount();
    await act(async () => { audioButton().props.onPress(); await Promise.resolve(); });
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    expect(index).toBe(1);
    native.player.currentTime = 27;
    native.player.playing = true;
    const toggle = renderer!.root.findAll(node => node.props?.accessibilityRole === 'switch')[0];
    await act(async () => toggle.props.onPress());
    await act(async () => toggle.props.onPress());
    expect(boundary.context.enabled).toBe(true);
    expect(native.player.currentTime).toBe(27);
    expect(native.player.playing).toBe(true);
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    expect(index).toBe(2);
    expect(native.player.calls.filter((call: string) => call === 'play')).toHaveLength(3);
  });

  it('stops on the next chapter when its recording is missing, without substituting another source', async () => {
    outcomeFor = usfm => usfm === 'JHN.19' ? { kind: 'unavailable', identity: { versionId: 46, usfm }, status: 'explicit_no_audio', message: '這一章沒有朗讀', retryable: false } : playable(usfm);
    await mount();
    await act(async () => { audioButton().props.onPress(); await Promise.resolve(); });
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(index).toBe(1);
    expect(native.player.calls.filter((call: string) => call === 'play')).toHaveLength(1);
    expect(renderer!.root.findAll(node => String(node.type) === 'Text').map(node => String(node.props.children)).join(' ')).toContain('這一章沒有朗讀，已停止連續播放。');
    expect(native.player.calls).not.toContain('replace:https://example.test/JHN.20.mp3');
  });

  it('does not re-arm an assigned EOF callback after the visible Reader moves to free browse', async () => {
    await mount(['TIT.1', 'TIT.2']);
    expect(boundary.context.enabled).toBe(true);

    await act(async () => {
      boundary.context.cancel(); // the official book/chapter callback cancels the current chain
      renderer!.update(React.createElement(Harness, { routeReferences: ['TIT.1', 'TIT.2'], book: 'GEN', chapter: '1' }));
      await Promise.resolve();
    });
    expect(boundary.context.enabled).toBe(true);
    expect(boundary.context.intent).toBeNull();

    await act(async () => {
      boundary.context.onPlaybackStarted('TIT.1'); // a delayed native callback from the old binding
      boundary.context.onPlaybackEnded('TIT.1');
      await Promise.resolve();
    });

    expect(index).toBe(0);
    expect(boundary.context.intent).toBeNull();
    expect(native.player.calls.filter((call: string) => call === 'play')).toHaveLength(0);
  });

  it('keeps a player/network failure distinct from an explicit missing recording', async () => {
    await mount();
    await act(async () => { audioButton().props.onPress(); await Promise.resolve(); });
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    expect(index).toBe(1);
    await act(async () => { native.player.fail(); });
    await act(async () => { await Promise.resolve(); });
    expect(renderer!.root.findAll(node => String(node.type) === 'Text').map(node => String(node.props.children)).join(' ')).toContain('朗讀暫時無法播放，已停止連續播放。');
    expect(renderer!.root.findAll(node => String(node.type) === 'Text').map(node => String(node.props.children)).join(' ')).not.toContain('這一章沒有朗讀，已停止連續播放。');
  });

  it('uses the latest day sequence when the same chapter/version binding survives a reference update', async () => {
    await mount(['JHN.18', 'JHN.19']);
    await act(async () => { renderer!.update(React.createElement(Harness, { routeReferences: ['JHN.18', 'JHN.20'] })); await Promise.resolve(); });
    await act(async () => { audioButton().props.onPress(); await Promise.resolve(); });
    await act(async () => { native.player.finish(); await Promise.resolve(); });
    expect(index).toBe(1);
    expect(native.player.calls.filter((call: string) => call === 'replace:https://example.test/JHN.18.mp3')).toHaveLength(1);
    expect(native.player.calls).toContain('replace:https://example.test/JHN.20.mp3');
    expect(native.player.calls).not.toContain('replace:https://example.test/JHN.19.mp3');
  });
});
