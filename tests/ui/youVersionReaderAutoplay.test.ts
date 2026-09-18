import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: any) => require('react').createElement(name, props, props.children));
const boundary = vi.hoisted(() => ({ context: null as any }));

vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'), BackHandler: { addEventListener: () => ({ remove() {} }) },
  Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), StyleSheet: { create: (value: unknown) => value },
  Text: primitive('Text'), View: primitive('View'),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => ({
  status: 'READER_UI_READY', module: {
    YouVersionProvider: primitive('Provider'), BibleReaderSettingsSheet: primitive('SettingsSheet'),
    BibleChapterPickerSheet: primitive('ChapterSheet'), BibleVersionPickerSheet: primitive('VersionSheet'),
    BibleReader: primitive('Reader'), getReaderSettings: () => null, getDefaultReaderSettings: () => null,
    setReaderSettings: () => {}, subscribeReaderSettings: () => ({ remove() {} }),
  },
}) }) }));
vi.mock('../../src/ui/BibleContentPreloadHost', () => ({ BibleContentPreloadHost: () => null }));

import { YouVersionReader } from '../../src/ui/YouVersionReader';
import { useChapterAudioAutoplay } from '../../src/ui/ChapterAudioControls';

function Probe() {
  const context = useChapterAudioAutoplay();
  boundary.context = context;
  return React.createElement('AutoplayProbe', { enabled: context.enabled, intent: context.intent, notice: context.notice, onToggle: context.toggle });
}

let renderer: TestRenderer.ReactTestRenderer | null = null;
let changed: number[];

beforeEach(() => { boundary.context = null; changed = []; });
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null; });

async function mount(props: Partial<React.ComponentProps<typeof YouVersionReader>> = {}) {
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(YouVersionReader, {
      date: '2026-09-12', references: ['JHN.18', 'JHN.19', 'JHN.20'], appKey: 'test', versionId: 46,
      allowTechnicalProbe: true, fullscreen: true, onActiveReferenceChange: index => changed.push(index),
      renderScreen: reader => React.createElement(React.Fragment, null, reader, React.createElement(Probe)),
      ...props,
    }));
    await Promise.resolve();
  });
}

describe('YouVersionReader reading highlight', () => {
  it('passes the narrated verse to the reader only while the narrated chapter is the displayed one', async () => {
    await mount();
    const reader = () => renderer!.root.findAll((node) => String(node.type) === 'Reader')[0];
    expect(reader().props.playingVerse).toBeNull();
    await act(async () => boundary.context.onPlayingVerse?.('JHN.18', 4));
    expect(reader().props.playingVerse).toBe(4);
    // A verse of another chapter must never paint the chapter on screen.
    await act(async () => boundary.context.onPlayingVerse?.('JHN.19', 2));
    expect(reader().props.playingVerse).toBeNull();
    await act(async () => boundary.context.onPlayingVerse?.('JHN.18', 5));
    expect(reader().props.playingVerse).toBe(5);
    await act(async () => boundary.context.onPlayingVerse?.('JHN.18', null));
    expect(reader().props.playingVerse).toBeNull();
  });
});

describe('YouVersionReader continuous playback orchestration', () => {
  it('advances one assigned reference per real EOF and stops after the last', async () => {
    await mount();
    expect(boundary.context.enabled).toBe(true);
    await act(async () => boundary.context.onPlaybackStarted('JHN.18'));
    const firstContext = boundary.context;
    await act(async () => boundary.context.onPlaybackEnded('JHN.18'));
    await act(async () => { await Promise.resolve(); });
    expect(changed).toEqual([1]);
    expect(boundary.context.intent).toMatchObject({ index: 1, usfm: 'JHN.19' });

    // Replaying the old callback cannot consume the new target.
    await act(async () => firstContext.onPlaybackEnded('JHN.18'));
    expect(changed).toEqual([1]);

    await act(async () => boundary.context.onPlaybackStarted('JHN.19'));
    await act(async () => boundary.context.onPlaybackEnded('JHN.19'));
    await act(async () => { await Promise.resolve(); });
    expect(changed).toEqual([1, 2]);
    await act(async () => boundary.context.onPlaybackStarted('JHN.20'));
    await act(async () => boundary.context.onPlaybackEnded('JHN.20'));
    expect(changed).toEqual([1, 2]);
  });

  it('stops on a missing or unavailable next recording with distinct concise notices', async () => {
    await mount();
    await act(async () => boundary.context.onPlaybackStarted('JHN.18'));
    await act(async () => boundary.context.onPlaybackEnded('JHN.18'));
    await act(async () => { await Promise.resolve(); });
    const targetContext = boundary.context;
    await act(async () => targetContext.onAutoplayUnavailable('JHN.19', 'explicit_no_audio'));
    await act(async () => { await Promise.resolve(); });
    expect(boundary.context.notice).toBe('這一章沒有朗讀，已停止連續播放。');
    expect(changed).toEqual([1]);

    act(() => renderer!.unmount()); renderer = null;
    await mount();
    await act(async () => boundary.context.onPlaybackStarted('JHN.18'));
    await act(async () => boundary.context.onPlaybackEnded('JHN.18'));
    await act(async () => { await Promise.resolve(); });
    await act(async () => boundary.context.onAutoplayUnavailable('JHN.19', 'temporarily_unavailable'));
    await act(async () => { await Promise.resolve(); });
    expect(boundary.context.notice).toBe('朗讀暫時無法取得，已停止連續播放。');
    expect(boundary.context.notice).not.toBe('這一章沒有朗讀，已停止連續播放。');
  });

  it('cancels a pending handoff on pause and the toggle does not start playback', async () => {
    const changedToggle = vi.fn();
    await mount({ onContinuousPlaybackChange: changedToggle });
    await act(async () => boundary.context.onPlaybackStarted('JHN.18'));
    await act(async () => boundary.context.onPlaybackEnded('JHN.18'));
    await act(async () => { await Promise.resolve(); });
    await act(async () => boundary.context.onPlaybackPaused('JHN.19'));
    expect(boundary.context.intent).toBeNull();
    expect(changed).toEqual([1]);
    await act(async () => boundary.context.toggle());
    expect(changedToggle).toHaveBeenCalledWith(false);
  });
});
