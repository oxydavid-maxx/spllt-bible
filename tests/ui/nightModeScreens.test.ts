import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 夜間模式 on screen (光佑 2026-11-04, mock C): the ⋯ row and page, the 我的帳戶 card, the 新功能 card, and the
// reader following the scheme. Same doubles as tests/ui/fullscreenReaderLayout.test.ts.
const native = vi.hoisted(() => ({
  focus: null as null | (() => void), blur: null as null | (() => void),
  setNavigationHidden: vi.fn(), setNavigationStyle: vi.fn(),
}));
vi.mock('react-native', () => ({
  TextInput: 'TextInput', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Modal: (props: any) => props.visible ? React.createElement('Modal', props, props.children) : null,
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' } },
  Appearance: { getColorScheme: () => 'light' }, useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 393, fontScale: 1 }),
  Linking: { openURL: vi.fn(async () => undefined) },
  BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Path: el('Path'), Rect: el('Rect') }; });
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => React.createElement('MaterialCommunityIcons') }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
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
vi.mock('../../src/ui/ChapterAudioControls', () => ({ ChapterAudioAutoplayNotice: () => null, ChapterAudioAutoplayToggle: () => null, ChapterAudioControls: React.forwardRef(() => React.createElement('ChapterAudioControls')) }));

import { FullscreenReaderLayout, useReaderChrome } from '../../src/ui/FullscreenReaderLayout';
import { NightModeContext, type NightModeBinding } from '../../src/ui/nightModeContext';
import { NightModeCard } from '../../src/ui/NightModeSettings';
import { NightModeNewsHost } from '../../src/ui/NightModeNewsHost';
import { AppThemeScope } from '../../src/ui/useAppTheme';
import { darkColors, lightColors } from '../../src/ui/Theme';
import { setUpdatePromptShowing } from '../../src/ui/updatePromptPresence';
import type { NightModeChoice } from '../../src/services/nightMode';
import type { ReaderOverlayControls } from '../../src/ui/YouVersionReader';

let renderer: TestRenderer.ReactTestRenderer | null = null;
let chrome: ReturnType<typeof useReaderChrome>;
let binding: NightModeBinding;
let scheme: 'light' | 'dark' = 'light';
const controls: ReaderOverlayControls = { ready: true, openSettings: vi.fn(), openChapterPicker: vi.fn(), openVersionPicker: vi.fn() } as unknown as ReaderOverlayControls;

function Reader() {
  chrome = useReaderChrome();
  return React.createElement(FullscreenReaderLayout, {
    reader: React.createElement('BibleReader'), controls, chrome, chapterUsfm: 'PSA.90', versionId: 139, references: ['PSA.90'],
    onSelectReference: vi.fn(), selectedDate: '2026-11-04', onSelectDate: vi.fn(),
    metadata: { translationName: '測試譯本', publisher: '測試出版社', copyrightNotice: '版權', officialUrl: '' },
  });
}
// The 新功能 card lives at the root (NightModeProvider renders NightModeNewsHost beside the app).
function ReaderWithNews(props: { withReader?: boolean }) {
  return React.createElement(React.Fragment, null, props.withReader === false ? null : React.createElement(Reader), React.createElement(NightModeNewsHost));
}
function wrap(child: React.ReactElement) {
  return React.createElement(NightModeContext.Provider, { value: binding }, React.createElement(AppThemeScope, { scheme }, child));
}
const all = (type: string) => renderer!.root.findAll((node) => String(node.type) === type);
const pressable = (label: string) => { const node = all('Pressable').find((item) => item.props.accessibilityLabel === label); expect(node, label).toBeDefined(); return node!; };
const words = (node = renderer!.root) => node.findAll((item) => String(item.type) === 'Text').map((item) => [item.props.children].flat(Infinity).join(''));
const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

beforeEach(() => {
  renderer = null;
  scheme = 'light';
  setUpdatePromptShowing(false);
  binding = { choice: 'auto', setChoice: vi.fn((choice: NightModeChoice) => { binding = { ...binding, choice }; }), newsDue: false, dismissNews: vi.fn(() => { binding = { ...binding, newsDue: false }; }) };
});

describe('⋯ 更多閱讀工具 → 夜間模式', () => {
  it('lists 夜間模式 right under 調整字體 with the choice in force and a ›', async () => {
    await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(Reader))); });
    act(() => pressable('更多閱讀工具').props.onPress());
    const labels = all('Pressable').map((node) => node.props.accessibilityLabel);
    expect(labels.indexOf('夜間模式，晚上自動')).toBe(labels.indexOf('調整字體') + 1);
    const row = pressable('夜間模式，晚上自動');
    expect(words(row)).toEqual(['夜間模式', '晚上自動 ›']);
  });

  it('opens the page with 返回, the four choices in order and the line for the current one', async () => {
    await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(Reader))); });
    act(() => pressable('更多閱讀工具').props.onPress());
    act(() => pressable('夜間模式，晚上自動').props.onPress());
    expect(words()).toEqual(expect.arrayContaining(['夜間模式', '返回', '只改這支手機', '18:00–06:00 深色，其他時間白底 (預設)']));
    const radios = all('Pressable').filter((node) => node.props.accessibilityRole === 'radio');
    expect(radios.map((node) => node.props.accessibilityLabel)).toEqual(['晚上自動', '跟手機', '一直深色', '一直白底']);
    expect(radios.map((node) => node.props.accessibilityState.checked)).toEqual([true, false, false, false]);
    act(() => radios[2].props.onPress());
    expect(binding.setChoice).toHaveBeenCalledWith('dark');
    // 返回 goes back to the menu, which now names the new choice.
    act(() => { renderer!.update(wrap(React.createElement(Reader))); });
    act(() => pressable('返回更多閱讀工具').props.onPress());
    expect(pressable('夜間模式，一直深色')).toBeDefined();
  });

  it('puts no moon or other shortcut on the reading page itself (光佑 chose C)', async () => {
    await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(Reader))); });
    expect(all('Pressable').some((node) => /夜間|月亮|深色/.test(String(node.props.accessibilityLabel ?? '')))).toBe(false);
  });
});

describe('我的帳戶 card', () => {
  it('says 夜間模式 · 只改這支手機 with the same four choices, and each note word for word', async () => {
    for (const [choice, note] of [['auto', '18:00–06:00 深色，其他時間白底 (預設)'], ['system', '手機設成深色，這裡就跟著深色'], ['dark', '一直是深色'], ['light', '一直是白底']] as const) {
      binding = { ...binding, choice };
      await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(NightModeCard))); });
      expect(words()).toEqual(['夜間模式', '只改這支手機', '晚上自動', '跟手機', '一直深色', '一直白底', note]);
      act(() => renderer!.unmount());
    }
  });
});

describe('新功能 card', () => {
  it('shows once over the reader (from the root) with the approved words', async () => {
    binding = { ...binding, newsDue: true };
    await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(ReaderWithNews))); });
    const card = all('View').find((node) => node.props.accessibilityLabel === '新功能：晚上自動變深色')!;
    expect(card).toBeDefined();
    expect(words(card)).toEqual([
      '06:00–18:00 白底', '18:00–06:00 深色', '新功能：晚上自動變深色', '晚上 6 點到早上 6 點，\nApp 會自動變深色，讀經不刺眼。',
      '想一直白底或跟手機，點讀經頁右上的 ⋯ →「夜間模式」，或到「我的帳戶」改。', '知道了', '改設定',
    ]);
    act(() => pressable('知道了').props.onPress());
    expect(binding.dismissNews).toHaveBeenCalledOnce();
  });

  it('改設定 puts it away and opens the four choices', async () => {
    vi.useFakeTimers();
    binding = { ...binding, newsDue: true };
    await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(ReaderWithNews))); });
    act(() => pressable('改設定').props.onPress());
    expect(binding.dismissNews).toHaveBeenCalledOnce();
    act(() => { renderer!.update(wrap(React.createElement(ReaderWithNews))); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(all('Pressable').filter((node) => node.props.accessibilityRole === 'radio').map((node) => node.props.accessibilityLabel)).toEqual(['晚上自動', '跟手機', '一直深色', '一直白底']);
    vi.useRealTimers();
  });

  // Run 41831056740: the reader unmounts and mounts again while it starts, and a card that lived inside it vanished.
  it('stays on screen while the reader under it unmounts and mounts again', async () => {
    binding = { ...binding, newsDue: true };
    await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(ReaderWithNews))); });
    const cards = () => all('View').filter((node) => node.props.accessibilityLabel === '新功能：晚上自動變深色').length;
    expect(cards()).toBe(1);
    act(() => { renderer!.update(wrap(React.createElement(ReaderWithNews, { withReader: false }))); });
    expect(cards()).toBe(1);
    act(() => { renderer!.update(wrap(React.createElement(ReaderWithNews))); });
    expect(cards()).toBe(1);
  });

  it('waits while 有新版本 is on screen', async () => {
    binding = { ...binding, newsDue: true };
    setUpdatePromptShowing(true);
    await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(ReaderWithNews))); });
    expect(all('View').some((node) => node.props.accessibilityLabel === '新功能：晚上自動變深色')).toBe(false);
    act(() => setUpdatePromptShowing(false));
    expect(all('View').some((node) => node.props.accessibilityLabel === '新功能：晚上自動變深色')).toBe(true);
  });
});

describe('the reader follows the scheme', () => {
  it('paints its page, header and buttons from the dark palette at night', async () => {
    scheme = 'dark';
    await act(async () => { renderer = TestRenderer.create(wrap(React.createElement(Reader))); });
    const toolbar = all('SafeAreaView').find((node) => node.props.accessibilityLabel === '閱讀工具列')!;
    expect(flat(toolbar.props.style).backgroundColor).toBe(darkColors.readerSurface);
    expect(flat(pressable('完成讀經').props.style).backgroundColor).toBe(darkColors.readerSurface);
    expect(all('StatusBar')[0].props.style).toBe('light');
    act(() => { scheme = 'light'; renderer!.update(wrap(React.createElement(Reader))); });
    expect(flat(toolbar.props.style).backgroundColor).toBe(lightColors.readerSurface);
    expect(all('StatusBar')[0].props.style).toBe('dark');
  });
});
