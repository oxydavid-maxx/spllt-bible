import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  focus: null as null | (() => void), blur: null as null | (() => void),
  screenReader: false, screenReaderChanged: null as null | ((enabled: boolean) => void),
  audioMounts: 0, audioUnmounts: 0,
  setNavigationHidden: vi.fn(),
  setNavigationStyle: vi.fn(),
  safeInsets: { top: 0, bottom: 0, left: 0, right: 0 },
}));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Modal: (props: any) => props.visible ? React.createElement('Modal', props, props.children) : null,
  StyleSheet: { create: (value: unknown) => value },
  Appearance: { getColorScheme: () => 'light' }, useColorScheme: () => 'light',
  Linking: { openURL: vi.fn(async () => undefined) },
  AccessibilityInfo: {
    isScreenReaderEnabled: async () => native.screenReader,
    addEventListener: (_name: string, listener: (enabled: boolean) => void) => {
      native.screenReaderChanged = listener;
      return { remove: () => { native.screenReaderChanged = null; } };
    },
  },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => native.safeInsets }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('../../node_modules/expo-navigation-bar/build/ExpoNavigationBar.js', () => ({ default: { setHidden: native.setNavigationHidden, setStyle: native.setNavigationStyle } }));
vi.mock('expo-navigation-bar', async () => import('../../node_modules/expo-navigation-bar/build/NavigationBar.android.js'));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => {
  React.useEffect(() => {
    const focus = () => { native.blur = callback() || null; };
    native.focus = focus;
    focus();
    return () => { native.blur?.(); native.focus = null; native.blur = null; };
  }, [callback]);
} }));
// Audio implementation belongs to a separate lane; assert only its mounting/lifecycle contract.
vi.mock('../../src/ui/ChapterAudioControls', () => ({ ChapterAudioAutoplayNotice: () => null, ChapterAudioAutoplayToggle: () => null, ChapterAudioControls: (props: any) => {
  React.useEffect(() => { native.audioMounts++; return () => { native.audioUnmounts++; }; }, []);
  return React.createElement('ChapterAudioControls', props);
} }));

import { FullscreenReaderLayout, useReaderChrome } from '../../src/ui/FullscreenReaderLayout';
import { NavigationBar } from 'expo-navigation-bar';
import type { ReaderOverlayControls } from '../../src/ui/YouVersionReader';

let chrome: ReturnType<typeof useReaderChrome>;
let renderer: TestRenderer.ReactTestRenderer | null;
let controls: ReaderOverlayControls;
let currentChapter = 'PSA.90';
let assignedReferences = ['PSA.90', 'PSA.91'];
let chosenVersion = 139;
let versionOptions: Array<{ versionId: number; translationName: string; languageTag: string }> | undefined;
let onSelectVersion: ((versionId: number) => void | Promise<void>) | undefined;
let audioAttribution: string | undefined;
const onExit = vi.fn();
const onSelectReference = vi.fn();
function Harness() {
  chrome = useReaderChrome();
  return React.createElement(FullscreenReaderLayout, {
    reader: React.createElement('BibleReader'), controls, chrome,
    chapterUsfm: currentChapter, versionId: chosenVersion, references: assignedReferences,
    onExit, onSelectReference,
    versionOptions, onSelectVersion,
    metadata: { translationName: '測試譯本', publisher: '測試出版社', copyrightNotice: '測試版權文字', officialUrl: 'https://example.test/version', audioAttribution },
  });
}
const all = (type: string) => renderer!.root.findAll(node => String(node.type) === type || (type === 'NavigationBar' && node.type === NavigationBar));
const button = (label: string) => { const node = all('Pressable').find(node => node.props.accessibilityLabel === label); expect(node, label).toBeDefined(); return node!; };
const styleOf = (node: TestRenderer.ReactTestInstance) => { expect(node).toBeDefined(); return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)); };
const text = () => JSON.stringify(renderer!.toJSON());
async function mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(Harness)); }); }

describe('fullscreen reader layout and chrome', () => {
  it('explains continuous reading in More, including current-state labels and playback boundaries', async () => {
    await mount();
    act(() => { button('更多閱讀工具').props.onPress(); });
    expect(text()).toContain('連讀是什麼？');
    expect(text()).toContain('這不是加快語速');
    expect(text()).toContain('開啟設定不會立即播放');
    expect(text()).toContain('遇到沒有朗讀的章節會停下並提示');
  });
  beforeEach(() => {
    vi.useFakeTimers();
    NavigationBar.setHidden(false);
    native.setNavigationHidden.mockClear();
    NavigationBar.setStyle('light');
    native.setNavigationStyle.mockClear();
    native.screenReader = false;
    native.audioMounts = 0;
    native.audioUnmounts = 0;
    native.safeInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    currentChapter = 'PSA.90';
    assignedReferences = ['PSA.90', 'PSA.91'];
    chosenVersion = 139;
    versionOptions = undefined;
    onSelectVersion = undefined;
    audioAttribution = undefined;
    controls = { ready: true, openChapterPicker: vi.fn(), openVersionPicker: vi.fn(), openSettings: vi.fn() };
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = String(args[0]);
      if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return;
      throw new Error(message);
    });
  });
  afterEach(() => {
    act(() => { renderer?.unmount(); });
    act(() => { vi.runOnlyPendingTimers(); });
    renderer = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('places visible wrapping daily controls before the flex reader without a fixed-height header or footer', async () => {
    await mount();
    const root = all('View')[0];
    expect(styleOf(root)).toMatchObject({ flex: 1, backgroundColor: '#FFFFFF' });
    expect(styleOf(root).padding).toBeUndefined();
    const reader = all('BibleReader')[0];
    expect(reader.parent?.type).toBe('View');
    expect(styleOf(reader.parent!)).toEqual({ flex: 1, paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 });
    const toolbar = all('SafeAreaView').find(node => node.props.accessibilityLabel === '閱讀工具列')!;
    expect(styleOf(toolbar).position).not.toBe('absolute');
    expect(styleOf(toolbar).height).toBeUndefined();
    expect(toolbar.props.pointerEvents).not.toBe('none');
    expect(toolbar.props.accessibilityElementsHidden).not.toBe(true);
    const siblings = root.children.filter(child => typeof child !== 'string');
    expect(siblings.indexOf(toolbar)).toBeLessThan(siblings.indexOf(reader.parent!));
    let row = all('ChapterAudioControls')[0].parent!;
    while (String(row.type) !== 'View') row = row.parent!;
    expect(styleOf(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(button('前往詩90').props.accessibilityState).toMatchObject({ selected: true });
    expect(styleOf(button('前往詩91'))).toMatchObject({ minWidth: 48, minHeight: 48 });
    expect(all('Pressable').some(node => ['選擇譯本', '調整字體', '選擇章節'].includes(node.props.accessibilityLabel))).toBe(false);
    expect(text()).not.toContain('測試版權文字');
    expect(text()).not.toContain('我已完成讀經');
    expect(text()).not.toContain('ProgressCard');
  });

  it('keeps daily tools visible through canvas taps, scroll, and idle time without unmounting audio', async () => {
    await mount();
    const audio = all('ChapterAudioControls')[0];
    expect(audio).toBeDefined();
    expect(audio.props).toMatchObject({ compact: true, active: true, detailsVisible: false });
    act(() => { chrome.toggleTools(); });
    expect(chrome.toolsVisible).toBe(true);
    act(() => { vi.advanceTimersByTime(3999); });
    expect(chrome.toolsVisible).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(chrome.toolsVisible).toBe(true);
    act(() => { chrome.toggleTools(); chrome.hideTools(); });
    expect(chrome.toolsVisible).toBe(true);
    expect(all('ChapterAudioControls')[0]).toBe(audio);
    expect(native.audioMounts).toBe(1);
    expect(native.audioUnmounts).toBe(0);
  });

  it('protects the reader using only current cutout/system insets and removes clearance when they become zero', async () => {
    native.safeInsets = { top: 31, bottom: 18, left: 0, right: 0 };
    await mount();
    const reader = all('BibleReader')[0];
    expect(styleOf(reader.parent!)).toMatchObject({ flex: 1, paddingTop: 0, paddingBottom: 18, paddingLeft: 0, paddingRight: 0 });
    expect(all('SafeAreaView').find(node => node.props.accessibilityLabel === '閱讀工具列')?.props.edges).toContain('top');
    native.safeInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    act(() => { renderer!.update(React.createElement(Harness)); });
    expect(all('BibleReader')[0]).toBe(reader);
    expect(styleOf(reader.parent!)).toMatchObject({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 });
  });

  it('applies landscape side cutouts without inventing a top status-bar gap', async () => {
    native.safeInsets = { top: 0, bottom: 0, left: 44, right: 12 };
    await mount();
    expect(styleOf(all('BibleReader')[0].parent!)).toMatchObject({ paddingTop: 0, paddingBottom: 0, paddingLeft: 44, paddingRight: 12 });
  });

  it.each(['More', 'Audio', 'Info'] as const)('keeps tools persistent across the compatible %s API', async popup => {
    await mount();
    act(() => { chrome[`open${popup}`](); });
    act(() => { vi.advanceTimersByTime(10000); });
    expect(chrome.toolsVisible).toBe(true);
    act(() => { chrome[`close${popup}`](); });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(chrome.toolsVisible).toBe(true);
  });

  it('keeps the audio owner mounted when a daily passage is selected', async () => {
    await mount();
    const audio = all('ChapterAudioControls')[0];
    act(() => { button('前往詩91').props.onPress(); });
    expect(onSelectReference).toHaveBeenCalledWith(1);
    currentChapter = 'PSA.91';
    act(() => { renderer!.update(React.createElement(Harness)); });
    expect(all('ChapterAudioControls')[0]).toBe(audio);
    expect(audio.props.chapterUsfm).toBe('PSA.91');
    expect(native.audioMounts).toBe(1);
    expect(native.audioUnmounts).toBe(0);
  });

  it('marks an assigned chapter range by membership and clears selection on unrelated browsing or date changes', async () => {
    assignedReferences = ['1TI.1', 'PSA.90-91', 'PSA.92'];
    currentChapter = 'PSA.91';
    await mount();
    expect(button('前往詩90-91').props.accessibilityState).toMatchObject({ selected: true });
    expect(button('前往詩92').props.accessibilityState).toMatchObject({ selected: false });
    for (const chapter of ['PSA.9', 'ZZZ.91', 'GEN.91']) {
      currentChapter = chapter;
      act(() => { renderer!.update(React.createElement(Harness)); });
      expect(all('Pressable').filter(node => node.props.accessibilityState?.selected)).toHaveLength(0);
    }
    currentChapter = 'PSA.91';
    assignedReferences = ['GEN.1', 'GEN.2'];
    act(() => { renderer!.update(React.createElement(Harness)); });
    expect(all('Pressable').filter(node => node.props.accessibilityState?.selected)).toHaveLength(0);
  });

  it('does not highlight unknown, reversed or cross-book assigned ranges', async () => {
    assignedReferences = ['PSA.90-GEN.92', 'PSA.92-90', 'ZZZ.90-91'];
    currentChapter = 'PSA.91';
    await mount();
    expect(all('Pressable').filter(node => node.props.accessibilityState?.selected)).toHaveLength(0);
  });

  it.each([false, true])('keeps common controls accessibility-visible with TalkBack=%s', async enabled => {
    native.screenReader = enabled;
    await mount();
    expect(chrome.toolsVisible).toBe(true);
    act(() => { chrome.hideTools(); vi.advanceTimersByTime(10000); });
    expect(chrome.toolsVisible).toBe(true);
    const toolbar = all('SafeAreaView').find(node => node.props.accessibilityLabel === '閱讀工具列')!;
    expect(toolbar.props.accessibilityElementsHidden).toBe(false);
    expect(toolbar.props.importantForAccessibility).toBe('auto');
    expect(button('前往詩90').props.accessibilityRole).toBe('button');
  });

  it('mounts system-bar overrides only while focused and closes every popup on blur', async () => {
    await mount();
    expect(all('StatusBar')).toHaveLength(1);
    expect(all('StatusBar')[0].props.hidden).toBe(true);
    expect(all('NavigationBar')[0].props.hidden).toBe(true);
    act(() => { chrome.openInfo(); });
    expect(all('StatusBar')[0].props.hidden).toBe(true);
    act(() => { native.blur?.(); });
    expect(chrome).toMatchObject({ focused: false, toolsVisible: false, moreOpen: false, audioOpen: false, infoOpen: false });
    expect(all('StatusBar')).toHaveLength(0);
    expect(all('NavigationBar')).toHaveLength(0);
    expect(all('ChapterAudioControls')[0].props.active).toBe(false);
    act(() => { native.focus?.(); });
    expect(chrome.focused).toBe(true);
    expect(chrome.toolsVisible).toBe(true);
  });

  it('restores actual Expo navigation visibility after blur and can re-enter fullscreen', async () => {
    await mount();
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(true);
    act(() => { native.blur?.(); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(false);
    act(() => { native.focus?.(); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(true);
  });

  it('uses actual native dark navigation controls against the white Reader surface', async () => {
    await mount();
    act(() => { vi.advanceTimersByTime(0); });
    act(() => { chrome.showTools(); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(true);
    expect(native.setNavigationStyle).toHaveBeenLastCalledWith('dark');
  });

  it('restores actual Expo navigation visibility when a focused reader unmounts', async () => {
    await mount();
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(true);
    act(() => { renderer!.unmount(); });
    renderer = null;
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(false);
  });

  it('closes a sheet when you tap outside it, which is what people expect and what was missing', async () => {
    await mount();
    act(() => { chrome.showTools(); button('更多閱讀工具').props.onPress(); });
    expect(chrome.moreOpen).toBe(true);
    act(() => { button('關閉更多閱讀工具').props.onPress(); });
    expect(chrome.moreOpen).toBe(false);

    act(() => { chrome.openInfo(); });
    expect(chrome.infoOpen).toBe(true);
    act(() => { button('關閉版本資訊').props.onPress(); });
    expect(chrome.infoOpen).toBe(false);
  });

  it('keeps only version, font settings, other chapters and information in More', async () => {
    await mount();
    act(() => { chrome.showTools(); button('更多閱讀工具').props.onPress(); });
    expect(chrome.moreOpen).toBe(true);
    const menu = all('Modal')[0];
    // The backdrop closes the sheet, an unlabelled wrapper swallows taps inside it, then the controls.
    expect(menu.findAll(node => String(node.type) === 'Pressable').map(node => node.props.accessibilityLabel)).toEqual(['關閉更多閱讀工具', undefined, '關閉', '選擇譯本', '調整字體', '選擇其他章節', '版本資訊']);
    act(() => { button('選擇譯本').props.onPress(); });
    expect(controls.openVersionPicker).toHaveBeenCalledOnce();
    expect(chrome.moreOpen).toBe(false);
    act(() => { chrome.openMore(); });
    act(() => { button('調整字體').props.onPress(); });
    expect(controls.openSettings).toHaveBeenCalledOnce();
    act(() => { chrome.openMore(); });
    act(() => { button('選擇其他章節').props.onPress(); });
    expect(controls.openChapterPicker).toHaveBeenCalledOnce();
    expect(chrome.moreOpen).toBe(false);
  });

  it('exposes copyright only in the dismissible Info modal and supports Android close', async () => {
    await mount();
    expect(text()).not.toContain('測試版權文字');
    act(() => { chrome.openMore(); });
    act(() => { button('版本資訊').props.onPress(); });
    expect(chrome.moreOpen).toBe(false);
    expect(text()).toContain('測試版權文字');
    const modal = all('Modal')[0];
    expect(modal.props.onRequestClose).toBeTypeOf('function');
    act(() => { modal.props.onRequestClose(); });
    expect(text()).not.toContain('測試版權文字');
  });

  it('keeps exit and chapter controls actionable without intercepting the ready reader surface', async () => {
    await mount();
    act(() => { button('返回今日').props.onPress(); chrome.openMore(); });
    act(() => { button('選擇其他章節').props.onPress(); });
    expect(onExit).toHaveBeenCalledOnce();
    expect(controls.openChapterPicker).toHaveBeenCalledOnce();
    expect(all('BibleReader')[0].parent?.props.onTouchEnd).toBeUndefined();
    controls.ready = false;
    act(() => { chrome.hideTools(); renderer!.update(React.createElement(Harness)); });
    act(() => { all('BibleReader')[0].parent?.props.onTouchEnd(); });
    expect(chrome.toolsVisible).toBe(true);
    expect(button('返回今日').props.disabled).not.toBe(true);
    act(() => { chrome.openMore(); });
    expect(button('選擇其他章節').props.disabled).toBe(true);
  });

  function enableCuratedVersions() {
    chosenVersion = 1392;
    versionOptions = [
      { versionId: 1392, translationName: '當代譯本（繁體）', languageTag: 'zh-Hant-TW' },
      { versionId: 312, translationName: '中文標準譯本（繁體）', languageTag: 'zh-Hant-TW' },
      { versionId: 111, translationName: 'New International Version', languageTag: 'en' },
    ];
    onSelectVersion = vi.fn();
  }
  function openCuratedVersions() {
    act(() => { chrome.openMore(); });
    act(() => { button('選擇譯本').props.onPress(); });
  }

  it('shows supplied verified versions grouped as Traditional Chinese and English with the current radio checked', async () => {
    enableCuratedVersions();
    controls.ready = false;
    await mount();
    openCuratedVersions();
    expect(controls.openVersionPicker).not.toHaveBeenCalled();
    expect(chrome.moreOpen).toBe(true);
    const groups = all('View').filter(node => node.props.accessibilityRole === 'radiogroup');
    expect(groups.map(node => node.props.accessibilityLabel)).toEqual(['繁體中文', 'English']);
    const choices = all('Pressable').filter(node => node.props.accessibilityRole === 'radio');
    expect(choices.map(node => node.props.accessibilityLabel)).toEqual(versionOptions!.map(option => option.translationName));
    expect(choices.map(node => node.props.accessibilityState.checked)).toEqual([true, false, false]);
    for (const choice of choices) expect(styleOf(choice).minHeight).toBeGreaterThanOrEqual(48);
  });

  it('keeps the version page open and disables duplicate selection until the preference resolves', async () => {
    enableCuratedVersions();
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    onSelectVersion = save;
    await mount();
    openCuratedVersions();
    const choice = button('New International Version');
    act(() => { choice.props.onPress(); choice.props.onPress(); });
    expect(save).toHaveBeenCalledExactlyOnceWith(111);
    expect(chrome.moreOpen).toBe(true);
    expect(button('New International Version').props.disabled).toBe(true);
    expect(text()).toContain('正在儲存譯本');
    await act(async () => { resolve(); });
    expect(chrome.moreOpen).toBe(false);
  });

  it('shows a short retryable message on rejected preference save without exposing the raw error', async () => {
    enableCuratedVersions();
    const save = vi.fn().mockRejectedValueOnce(new Error('secret-network-detail')).mockResolvedValueOnce(undefined);
    onSelectVersion = save;
    await mount();
    openCuratedVersions();
    await act(async () => { button('New International Version').props.onPress(); });
    expect(chrome.moreOpen).toBe(true);
    expect(text()).toContain('譯本未儲存，請再試一次。');
    expect(text()).not.toContain('secret-network-detail');
    expect(button('New International Version').props.disabled).toBe(false);
    await act(async () => { button('New International Version').props.onPress(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(chrome.moreOpen).toBe(false);
  });

  it('supports version-page back, Android back, and close without leaving stale page state', async () => {
    enableCuratedVersions();
    await mount();
    openCuratedVersions();
    act(() => { button('返回更多閱讀工具').props.onPress(); });
    expect(chrome.moreOpen).toBe(true);
    expect(all('Pressable').filter(node => node.props.accessibilityRole === 'radio')).toHaveLength(0);
    act(() => { button('選擇譯本').props.onPress(); });
    act(() => { all('Modal')[0].props.onRequestClose(); });
    expect(button('版本資訊')).toBeDefined();
    act(() => { button('選擇譯本').props.onPress(); });
    act(() => { button('關閉譯本選擇').props.onPress(); });
    expect(chrome.moreOpen).toBe(false);
    act(() => { chrome.openMore(); });
    expect(button('版本資訊')).toBeDefined();
  });

  it('ignores a late completed save after leaving the version page and reopening More', async () => {
    enableCuratedVersions();
    let resolve!: () => void;
    onSelectVersion = () => new Promise<void>(done => { resolve = done; });
    await mount();
    openCuratedVersions();
    act(() => { button('New International Version').props.onPress(); });
    act(() => { button('關閉譯本選擇').props.onPress(); });
    act(() => { chrome.openMore(); });
    await act(async () => { resolve(); });
    expect(chrome.moreOpen).toBe(true);
    expect(button('版本資訊')).toBeDefined();
  });

  it('clears the curated page when opening Info and displays supplied recording attribution only there', async () => {
    enableCuratedVersions();
    audioAttribution = '測試錄音版權 ℗ 2026';
    await mount();
    expect(text()).not.toContain(audioAttribution);
    openCuratedVersions();
    act(() => { chrome.openInfo(); });
    expect(text()).toContain(audioAttribution);
    expect(all('Pressable').filter(node => node.props.accessibilityRole === 'radio')).toHaveLength(0);
    act(() => { chrome.closeInfo(); chrome.openMore(); });
    expect(button('選擇譯本')).toBeDefined();
    expect(text()).not.toContain(audioAttribution);
  });
});
