import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  focus: null as null | (() => void), blur: null as null | (() => void),
  screenReader: false, screenReaderChanged: null as null | ((enabled: boolean) => void),
  backHandlers: [] as Array<() => boolean>,
  audioMounts: 0, audioUnmounts: 0,
  setNavigationHidden: vi.fn(),
  setNavigationStyle: vi.fn(),
  pauseAudio: vi.fn(async () => undefined),
  safeInsets: { top: 0, bottom: 0, left: 0, right: 0 },
  window: { width: 393, fontScale: 1 },
}));
vi.mock('react-native', () => ({
  TextInput: 'TextInput', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Modal: (props: any) => props.visible ? React.createElement('Modal', props, props.children) : null,
  StyleSheet: { create: (value: unknown) => value },
  Appearance: { getColorScheme: () => 'light' }, useColorScheme: () => 'light',
  useWindowDimensions: () => native.window,
  Linking: { openURL: vi.fn(async () => undefined) },
  BackHandler: { addEventListener: (_name: string, handler: () => boolean) => { native.backHandlers.push(handler); return { remove: () => { native.backHandlers = native.backHandlers.filter(h => h !== handler); } }; } },
  AccessibilityInfo: {
    isScreenReaderEnabled: async () => native.screenReader,
    addEventListener: (_name: string, listener: (enabled: boolean) => void) => {
      native.screenReaderChanged = listener;
      return { remove: () => { native.screenReaderChanged = null; } };
    },
  },
}));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => React.createElement('MaterialCommunityIcons') }));
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
// Audio implementation belongs to a separate lane; assert only its mounting/lifecycle contract
// and where in the chrome it is placed.
vi.mock('../../src/ui/ChapterAudioControls', () => ({ ChapterAudioAutoplayNotice: () => null, ChapterAudioAutoplayToggle: (props: any) => React.createElement('Pressable', { accessibilityRole: 'switch', accessibilityLabel: '連讀', ...props }), ChapterAudioControls: React.forwardRef((props: any, ref: any) => {
  React.useEffect(() => { native.audioMounts++; return () => { native.audioUnmounts++; }; }, []);
  React.useImperativeHandle(ref, () => ({ pause: native.pauseAudio }));
  return React.createElement('View', { style: { width: props.readerAction ? 56 : 48, height: props.readerAction ? 56 : 48 } },
    React.createElement('Pressable', { accessibilityRole: 'button', accessibilityLabel: '播放詩篇 90', style: { width: props.readerAction ? 56 : 48, height: props.readerAction ? 56 : 48, minHeight: props.readerAction ? 56 : 48 } },
      React.createElement('ChapterAudioControls', props)));
}) }));

import { FullscreenReaderLayout, useReaderChrome } from '../../src/ui/FullscreenReaderLayout';
import { NavigationBar } from 'expo-navigation-bar';
import type { ReaderOverlayControls } from '../../src/ui/YouVersionReader';
import { formatReadingDateHeader } from '../../src/ui/ReadingDateNavigator';
import { taipeiDate } from '../../src/domain/gamificationV1';

let chrome: ReturnType<typeof useReaderChrome>;
let renderer: TestRenderer.ReactTestRenderer | null;
let controls: ReaderOverlayControls;
let currentChapter = 'PSA.90';
let assignedReferences = ['PSA.90', 'PSA.91'];
let selectionSource: 'ASSIGNED' | 'FREE' = 'ASSIGNED';
let activeReferenceIndex = 0;
let chosenVersion = 139;
let versionOptions: Array<{ versionId: number; translationName: string; languageTag: string }> | undefined;
let onSelectVersion: ((versionId: number) => void | Promise<void>) | undefined;
let audioAttribution: string | undefined;
let onSelectNarrationSpeed: ((speed: number) => void) | undefined;
let selectedDate = '2026-09-23';
let previousDate: string | undefined = '2026-09-22';
let nextDate: string | undefined = '2026-09-24';
let completed = false;
let completionDisabled = false;
let completionPending = false;
let completionFailed = false;
let completionLabel: string | undefined;
let onComplete: (() => void) | undefined;
let onUndo: (() => void) | undefined;
let onSelectDate: (date: string) => void;
let noPlanMessage: string | undefined;
let statusMessage: string | undefined;
let canOpenYouVersion = false;
let accountNode: React.ReactNode | undefined;
let loginGateNode: React.ReactNode | undefined;
let updateNode: React.ReactNode | undefined;
let onOpenYouVersion: (() => void) | undefined;
const onSelectReference = vi.fn();
function Harness() {
  chrome = useReaderChrome();
  return React.createElement(FullscreenReaderLayout, {
    reader: React.createElement('BibleReader'), controls, chrome,
    chapterUsfm: currentChapter, versionId: chosenVersion, references: assignedReferences, selectionSource, activeReferenceIndex,
    selectedDate, previousDate, nextDate, onSelectDate,
    completed, completionDisabled, completionPending, completionFailed, completionLabel, onComplete, onUndo, onSelectReference,
    noPlanMessage, statusMessage, canOpenYouVersion, accountEntry: accountNode, loginGate: loginGateNode, updateBanner: updateNode,
    onOpenYouVersion,
    versionOptions, onSelectVersion, onSelectNarrationSpeed,
    metadata: { translationName: '測試譯本', publisher: '測試出版社', copyrightNotice: '測試版權文字', officialUrl: 'https://example.test/version', audioAttribution },
  });
}
const all = (type: string) => renderer!.root.findAll(node => String(node.type) === type || (type === 'NavigationBar' && node.type === NavigationBar));
const button = (label: string) => { const node = all('Pressable').find(node => node.props.accessibilityLabel === label); expect(node, label).toBeDefined(); return node!; };
const chip = (text: string) => { const node = all('Pressable').find(node => node.props.accessibilityState && 'selected' in node.props.accessibilityState && node.findAll(child => String(child.type) === 'Text').map(t => t.props.children).join('') === text); expect(node, text).toBeDefined(); return node!; };
const styleOf = (node: TestRenderer.ReactTestInstance) => { expect(node).toBeDefined(); return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)); };
const text = () => JSON.stringify(renderer!.toJSON());
const toolbar = () => all('SafeAreaView').find(node => node.props.accessibilityLabel === '閱讀工具列');
const actionRow = () => all('View').find(node => node.props.accessibilityLabel === '讀經動作')!;
const surface = () => all('BibleReader')[0].parent!;
async function mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(Harness)); }); }

describe('fullscreen reader layout and chrome', () => {
  it('explains continuous reading in More, including current-state labels and playback boundaries', async () => {
    await mount();
    act(() => { button('更多閱讀工具').props.onPress(); });
    expect(text()).toContain('連讀是什麼？');
    expect(text()).toContain('這不是加快語速');
    expect(text()).toContain('切換設定不會立即播放');
    expect(text()).toContain('遇到沒有朗讀的章節會停下並提示');
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T04:00:00Z'));
    NavigationBar.setHidden(false);
    native.setNavigationHidden.mockClear();
    NavigationBar.setStyle('light');
    native.setNavigationStyle.mockClear();
    native.screenReader = false;
    native.backHandlers = [];
    native.audioMounts = 0;
    native.audioUnmounts = 0;
    native.pauseAudio.mockClear();
    native.safeInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    native.window = { width: 393, fontScale: 1 };
    currentChapter = 'PSA.90';
    assignedReferences = ['PSA.90', 'PSA.91'];
    selectionSource = 'ASSIGNED';
    activeReferenceIndex = 0;
    chosenVersion = 139;
    versionOptions = undefined;
    onSelectVersion = undefined;
    audioAttribution = undefined;
    onSelectNarrationSpeed = undefined;
    selectedDate = '2026-09-23'; previousDate = '2026-09-22'; nextDate = '2026-09-24';
    completed = false; completionDisabled = false; completionPending = false; completionFailed = false; completionLabel = undefined; onComplete = undefined; onUndo = undefined;
    onSelectDate = vi.fn(); noPlanMessage = undefined; statusMessage = undefined; canOpenYouVersion = false;
    accountNode = undefined; loginGateNode = undefined; updateNode = undefined; onOpenYouVersion = undefined;
    onSelectReference.mockClear();
    controls = { ready: true, openChapterPicker: vi.fn(), openVersionPicker: vi.fn(), openSettings: vi.fn() };
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = String(args[0]);
      if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act') || message.includes('Accessing element.ref was removed in React 19')) return;
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

  it('keeps date arrows and the weekday in row one and today\'s chapter chips with More in row two, floating over the scripture', async () => {
    await mount();
    const root = all('View')[0];
    expect(styleOf(root)).toMatchObject({ flex: 1, backgroundColor: '#FFFFFF' });
    expect(styleOf(root).padding).toBeUndefined();
    expect(surface().props.accessibilityLabel).toBe('經文');
    expect(styleOf(surface())).toEqual({ flex: 1, paddingLeft: 0, paddingRight: 0 });
    const header = toolbar()!;
    expect(styleOf(header)).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0 });
    expect(header.props.edges).toContain('top');
    const siblings = root.children.filter(child => typeof child !== 'string');
    expect(siblings.indexOf(surface())).toBeLessThan(siblings.indexOf(header));
    const dateRow = all('View').find(node => node.props.accessibilityLabel === '閱讀日期工具列')!;
    const chipsRow = all('View').find(node => node.props.accessibilityLabel === '今日讀經章節')!;
    expect(styleOf(dateRow)).toMatchObject({ minHeight: 48 });
    expect(styleOf(chipsRow)).toMatchObject({ minHeight: 48 });
    expect(styleOf(dateRow).flexWrap).not.toBe('wrap');
    expect(dateRow.findAll(node => String(node.type) === 'Pressable').map(node => node.props.accessibilityLabel)).toEqual([
      '上一個排定讀經日', '下一個排定讀經日',
    ]);
    expect(dateRow.findAll(node => String(node.type) === 'Text').map(node => node.props.children)).toContain(formatReadingDateHeader(selectedDate, taipeiDate()));
    expect(chipsRow.findAll(node => node.props.accessibilityLabel === '更多閱讀工具')).toHaveLength(1);
    expect(dateRow.findAll(node => node.props.accessibilityLabel === '更多閱讀工具')).toHaveLength(0);
    expect(chipsRow.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityState?.selected !== undefined)
      .map(node => node.findAll(child => String(child.type) === 'Text').map(t => t.props.children).join(''))).toEqual(['詩90', '詩91']);
    expect(chip('詩90').props.accessibilityLabel).toBe('詩篇 90，今日第1段，共2段');
    expect(styleOf(button('上一個排定讀經日'))).toMatchObject({ minWidth: 48, minHeight: 48 });
    expect(styleOf(button('下一個排定讀經日'))).toMatchObject({ minWidth: 48, minHeight: 48 });
    expect(styleOf(button('更多閱讀工具')).minHeight).toBeGreaterThanOrEqual(48);
    expect(styleOf(button('更多閱讀工具')).minWidth).toBeGreaterThanOrEqual(48);
    for (const label of ['上一個排定讀經日', '下一個排定讀經日', '更多閱讀工具']) {
      expect(button(label).props.accessibilityRole).toBe('button');
    }
    expect(all('Text').some(node => node.props.children === '9/22')).toBe(true);
    expect(all('Text').some(node => node.props.children === '9/24')).toBe(true);
    // The book name appears once per screen: only the chips carry the chapter (no range row, no capsule).
    expect(text()).not.toContain('詩篇90–91');
    expect(all('Pressable').some(node => ['選擇今日章節清單', '上一個讀經章節', '下一個讀經章節'].includes(node.props.accessibilityLabel))).toBe(false);
    expect(all('Pressable').some(node => ['選擇譯本', '調整字體', '選擇章節'].includes(node.props.accessibilityLabel))).toBe(false);
    expect(text()).not.toContain('測試版權文字');
    expect(text()).not.toContain('我已完成讀經');
    expect(text()).not.toContain('ProgressCard');
  });

  it('keeps date arrows disabled and inert at the schedule boundaries', async () => {
    previousDate = undefined;
    nextDate = undefined;
    await mount();
    const previous = button('上一個排定讀經日');
    const next = button('下一個排定讀經日');
    expect(previous.props.disabled).toBe(true);
    expect(next.props.disabled).toBe(true);
    act(() => { previous.props.onPress(); next.props.onPress(); });
    expect(onSelectDate).not.toHaveBeenCalled();
  });

  it('keeps the selected weekday and the current chapter chip intact at 320dp with large text', async () => {
    native.window = { width: 320, fontScale: 1 };
    await mount();
    expect(all('Text').some(node => node.props.children === '9/22')).toBe(true);
    expect(all('Text').some(node => node.props.children === '9/24')).toBe(true);
    await act(async () => { renderer!.unmount(); });
    renderer = null;

    native.window = { width: 320, fontScale: 2 };
    await mount();
    const dateRow = all('View').find(node => node.props.accessibilityLabel === '閱讀日期工具列')!;
    const dateTitle = dateRow.findAll(node => String(node.type) === 'Text')[0];
    expect(all('Text').some(node => node.props.children === '9/22')).toBe(false);
    expect(all('Text').some(node => node.props.children === '9/24')).toBe(false);
    expect(dateTitle.props.children).toBe(formatReadingDateHeader(selectedDate, taipeiDate()));
    expect(button('上一個排定讀經日').props.accessibilityHint).toBe('前往9/22');
    expect(button('下一個排定讀經日').props.accessibilityHint).toBe('前往9/24');
    const current = chip('詩90');
    expect(current.props.accessibilityRole).toBe('button');
    expect(current.props.accessibilityState).toMatchObject({ selected: true });
    expect(styleOf(current).minHeight).toBeGreaterThanOrEqual(48);
    // Chips scroll sideways instead of wrapping or truncating when text is large.
    expect(all('ScrollView').some(node => node.props.horizontal && node.findAll(child => child === current).length === 1)).toBe(true);
  });

  it('keeps icon-only completion and the audio owner as the two 56dp actions', async () => {
    await mount();
    const row = actionRow();
    const finish = button('完成讀經');
    expect(styleOf(row)).toMatchObject({ position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 12 });
    expect(row.children.filter(child => typeof child !== 'string')).toHaveLength(2);
    expect(styleOf(finish)).toMatchObject({ width: 56, height: 56 });
    expect(finish.findAll(node => String(node.type) === 'Text')).toHaveLength(0);
    expect(finish.props.accessibilityRole).toBe('button');
    expect(row.findAll(node => String(node.type) === 'Pressable').some(node => node.props.accessibilityLabel === '靈修日記')).toBe(false);
    expect(styleOf(button('播放詩篇 90'))).toMatchObject({ width: 56, height: 56, minHeight: 56 });
    expect(row.findAll(node => String(node.type) === 'ChapterAudioControls')).toHaveLength(1);
    expect(all('ChapterAudioControls')[0].props).toMatchObject({ bottomCell: false, readerAction: true, active: true });
  });

  it('keeps no-plan and sync-error states visible while disabling completion', async () => {
    assignedReferences = [];
    selectionSource = 'FREE';
    noPlanMessage = '這一天沒有排定讀經。';
    statusMessage = '同步遇到問題';
    completionDisabled = true;
    completionLabel = '無排定讀經';
    await mount();
    expect(text()).toContain('這一天沒有排定讀經。');
    expect(text()).toContain('同步遇到問題');
    expect(button('無排定讀經').props.disabled).toBe(true);
    expect(chip('自由 詩90').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('announces pending completion and keeps the completed action clearly reversible', async () => {
    completionPending = true;
    completionDisabled = true;
    onComplete = vi.fn();
    await mount();
    expect(button('同步中').props).toMatchObject({
      accessibilityRole: 'button', disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(all('Text').some(node => node.props.children === '同步中')).toBe(false);
    await act(async () => { renderer!.unmount(); });
    renderer = null;

    completionPending = false;
    completionDisabled = false;
    completed = true;
    onComplete = vi.fn();
    onUndo = vi.fn();
    await mount();
    const undo = button('已完成，可撤銷完成確認');
    expect(undo.props).toMatchObject({ accessibilityRole: 'button', disabled: false, accessibilityState: { checked: true } });
    expect(all('Text').some(node => node.props.children === '已完成')).toBe(false);
    act(() => { undo.props.onPress(); });
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each([['PSA.90', '詩90', '詩篇 90'], ['1TI.1', '提前1', '提摩太前書 1']] as const)('names free reading of %s with a short chip and a full spoken label', async (chapter, short, full) => {
    currentChapter = chapter;
    selectionSource = 'FREE';
    activeReferenceIndex = -1;
    await mount();
    const free = chip(`自由 ${short}`);
    expect(free.props.accessibilityLabel).toBe(`自由閱讀：${full}`);
    act(() => { free.props.onPress(); });
    expect(controls.openChapterPicker).toHaveBeenCalledOnce();
    expect(all('Pressable').filter(node => node.props.accessibilityState?.selected === true)).toHaveLength(1);
  });

  it('keeps play/pause actionable after downward scroll and restores the other tools on reverse scroll', async () => {
    await mount();
    act(() => chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }));
    expect(chrome.toolsVisible).toBe(false);
    expect(toolbar()).toBeUndefined();
    expect(all('ChapterAudioControls')).toHaveLength(1);
    expect(button('播放詩篇 90')).toBeDefined();
    act(() => chrome.handleCanvasScroll({ direction: 'up', deltaY: -20 }));
    expect(chrome.toolsVisible).toBe(true);
    expect(button('更多閱讀工具')).toBeDefined();
  });

  it('clears shared tab immersion when Reader loses focus', async () => {
    const { getReaderImmersionSnapshot } = await import('../../src/ui/readerImmersionState');
    await mount();
    act(() => chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }));
    expect(getReaderImmersionSnapshot()).toBe(true);
    act(() => { native.blur?.(); });
    expect(getReaderImmersionSnapshot()).toBe(false);
    act(() => { native.focus?.(); });
    expect(chrome.toolsVisible).toBe(true);
    expect(getReaderImmersionSnapshot()).toBe(false);
  });

  it('draws the tools over the scripture and keeps 連讀 in More', async () => {
    await mount();
    const root = all('View')[0];
    const siblings = root.children.filter(child => typeof child !== 'string');
    for (const overlay of [toolbar()!, actionRow()]) expect(siblings.indexOf(surface())).toBeLessThan(siblings.indexOf(overlay));
    expect(toolbar()!.findAll(node => String(node.type) === 'ChapterAudioControls')).toHaveLength(0);
    expect(all('Pressable').some(node => node.props.accessibilityLabel === '連讀')).toBe(false);
    act(() => button('更多閱讀工具').props.onPress());
    expect(all('Pressable').some(node => node.props.accessibilityRole === 'switch' && node.props.accessibilityLabel === '連讀')).toBe(true);
  });

  it('places ○ ▶ above the tab bar from the system insets, 12dp apart, and keeps ▶ there while collapsed', async () => {
    native.safeInsets = { top: 0, bottom: 18, left: 8, right: 4 };
    await mount();
    const expected = { right: 8 + 4, bottom: 49 + 18 + 12 };
    expect(styleOf(actionRow())).toMatchObject({ ...expected, gap: 12, alignItems: 'center' });
    const slots = actionRow().children.filter(child => typeof child !== 'string') as TestRenderer.ReactTestInstance[];
    expect(slots.map(slot => [styleOf(slot).width, styleOf(slot).height])).toEqual([[56, 56], [56, 56]]);
    act(() => chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }));
    // The system bars hide while collapsed and the live insets drop to zero; ▶ must not move.
    native.safeInsets = { top: 0, bottom: 0, left: 8, right: 4 };
    act(() => { renderer!.update(React.createElement(Harness)); });
    expect(styleOf(actionRow())).toMatchObject(expected);
    expect(actionRow().children.filter(child => typeof child !== 'string')).toHaveLength(1);
    expect(button('播放詩篇 90')).toBeDefined();
  });

  it('collapses tools on effective downward scroll and keeps the same audio owner mounted', async () => {
    await mount();
    const audio = all('ChapterAudioControls')[0];
    expect(audio).toBeDefined();
    expect(audio.props).toMatchObject({ bottomCell: false, readerAction: true, active: true });
    act(() => { chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }); });
    expect(chrome.toolsVisible).toBe(false);
    expect(all('ChapterAudioControls')[0].props.bottomCell).toBe(false);
    expect(button('播放詩篇 90')).toBeDefined();
    act(() => { vi.advanceTimersByTime(3999); });
    expect(chrome.toolsVisible).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(chrome.toolsVisible).toBe(false);
    act(() => { chrome.openMore(); });
    expect(chrome.toolsVisible).toBe(true);
    act(() => { chrome.closeMore(); chrome.handleCanvasScroll({ direction: 'up', deltaY: -20 }); });
    expect(chrome.toolsVisible).toBe(true);
    expect(all('ChapterAudioControls')[0]).toBe(audio);
    expect(native.audioMounts).toBe(1);
    expect(native.audioUnmounts).toBe(0);
  });

  it('keeps the scripture full height and only pads side cutouts, whatever the top and bottom insets are', async () => {
    native.safeInsets = { top: 31, bottom: 18, left: 0, right: 0 };
    await mount();
    const reader = all('BibleReader')[0];
    expect(styleOf(surface())).toEqual({ flex: 1, paddingLeft: 0, paddingRight: 0 });
    expect(toolbar()?.props.edges).toContain('top');
    native.safeInsets = { top: 0, bottom: 0, left: 44, right: 12 };
    act(() => { renderer!.update(React.createElement(Harness)); });
    expect(all('BibleReader')[0]).toBe(reader);
    expect(styleOf(surface())).toEqual({ flex: 1, paddingLeft: 44, paddingRight: 12 });
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
    act(() => { chip('詩91').props.onPress(); });
    expect(onSelectReference).toHaveBeenCalledWith(1);
    currentChapter = 'PSA.91';
    activeReferenceIndex = 1;
    act(() => { renderer!.update(React.createElement(Harness)); });
    expect(all('ChapterAudioControls')[0]).toBe(audio);
    expect(audio.props.chapterUsfm).toBe('PSA.91');
    expect(chip('詩91').props.accessibilityState).toMatchObject({ selected: true });
    expect(native.audioMounts).toBe(1);
    expect(native.audioUnmounts).toBe(0);
  });

  it('forgets the chapter end when the chapter changes, so the next chapter does not open with its end actions', async () => {
    await mount();
    act(() => { chrome.handleCanvasEdge({ atEnd: true }); });
    expect(text()).toContain('繼續讀 詩91 ›');
    currentChapter = 'PSA.91';
    activeReferenceIndex = 1;
    act(() => { renderer!.update(React.createElement(Harness)); });
    expect(chrome.atChapterEnd).toBe(false);
    expect(text()).not.toContain('完成今日讀經');
    act(() => { chrome.handleCanvasEdge({ atEnd: true }); });
    expect(text()).toContain('完成今日讀經');
    expect(text()).not.toContain('繼續讀');
  });

  it.each([false, true])('keeps common controls accessibility-visible with TalkBack=%s', async enabled => {
    native.screenReader = enabled;
    await mount();
    expect(chrome.toolsVisible).toBe(true);
    act(() => { chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }); vi.advanceTimersByTime(10000); });
    expect(chrome.toolsVisible).toBe(enabled);
    if (enabled) {
      expect(toolbar()).toBeDefined();
      expect(chip('詩90')).toBeDefined();
      expect(button('播放詩篇 90')).toBeDefined();
    } else {
      expect(toolbar()).toBeUndefined();
      expect(button('播放詩篇 90')).toBeDefined();
      act(() => { chrome.revealTools('up'); });
    }
    expect(chip('詩91').props.accessibilityRole).toBe('button');
  });

  it('restores the full controls immediately when TalkBack turns on while immersed', async () => {
    const { getReaderImmersionSnapshot } = await import('../../src/ui/readerImmersionState');
    await mount();
    act(() => { chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }); });
    expect(chrome.toolsVisible).toBe(false);
    expect(toolbar()).toBeUndefined();
    act(() => { native.screenReaderChanged?.(true); });
    expect(chrome.toolsVisible).toBe(true);
    expect(getReaderImmersionSnapshot()).toBe(false);
    expect(toolbar()).toBeDefined();
    expect(button('播放詩篇 90')).toBeDefined();
  });

  it('mounts system-bar overrides only while focused, hides them only while collapsed, and closes every popup on blur', async () => {
    await mount();
    expect(all('StatusBar')).toHaveLength(1);
    expect(all('StatusBar')[0].props.hidden).toBe(false);
    expect(all('NavigationBar')[0].props.hidden).toBe(false);
    act(() => { chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }); });
    expect(all('StatusBar')[0].props.hidden).toBe(true);
    expect(all('NavigationBar')[0].props.hidden).toBe(true);
    act(() => { chrome.openInfo(); });
    expect(all('StatusBar')[0].props.hidden).toBe(false);
    act(() => { native.blur?.(); });
    expect(chrome).toMatchObject({ focused: false, toolsVisible: false, collapsed: false, moreOpen: false, audioOpen: false, infoOpen: false });
    expect(all('StatusBar')).toHaveLength(0);
    expect(all('NavigationBar')).toHaveLength(0);
    expect(all('ChapterAudioControls')[0].props.active).toBe(false);
    act(() => { native.focus?.(); });
    expect(chrome.focused).toBe(true);
    expect(chrome.toolsVisible).toBe(true);
  });

  it('shows the actual Expo navigation bar normally, hides it only while collapsed, and restores it after blur', async () => {
    await mount();
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).not.toHaveBeenCalledWith(true);
    act(() => { chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(true);
    act(() => { native.blur?.(); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(false);
    act(() => { native.focus?.(); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(false);
    act(() => { chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationHidden).toHaveBeenLastCalledWith(true);
  });

  it('uses actual native dark navigation controls against the white Reader surface', async () => {
    await mount();
    act(() => { vi.advanceTimersByTime(0); });
    act(() => { chrome.showTools(); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(native.setNavigationStyle).toHaveBeenLastCalledWith('dark');
  });

  it('restores actual Expo navigation visibility when a collapsed reader unmounts', async () => {
    await mount();
    act(() => { chrome.handleCanvasScroll({ direction: 'down', deltaY: 20 }); });
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

  it.each(['more', 'versions', 'info'] as const)('bounds the %s sheet against the screen and lets only its body shrink and scroll', async (page) => {
    if (page === 'versions') enableCuratedVersions();
    onSelectNarrationSpeed = vi.fn();
    await mount();
    act(() => { page === 'info' ? chrome.openInfo() : chrome.openMore(); });
    if (page === 'versions') act(() => { button('選擇譯本').props.onPress(); });
    const sheet = all('SafeAreaView').find(node => node.props.accessibilityViewIsModal)!;
    const host = sheet.parent!;
    // A percentage on the inner sheet resolves against an intrinsically sized wrapper. On the
    // device that clipped the speed row while scrolling could not reveal the final Info action.
    // Put the limit on the direct child of the full-screen backdrop, then propagate shrinkability.
    expect(styleOf(host.parent!)).toMatchObject({ flex: 1, justifyContent: 'flex-end' });
    expect(styleOf(host)).toMatchObject({ maxHeight: '85%', flexShrink: 1 });
    expect(styleOf(sheet).maxHeight).toBeUndefined();
    expect(styleOf(sheet)).toMatchObject({ flexShrink: 1, minHeight: 0 });
    expect(sheet.props.edges).toContain('bottom');
    const scroll = sheet.findAll(node => String(node.type) === 'ScrollView')[0];
    expect(styleOf(scroll)).toMatchObject({ flexShrink: 1, minHeight: 0 });
    expect(scroll.props.scrollEnabled).not.toBe(false);
    const header = sheet.findAll(node => String(node.type) === 'View' && styleOf(node).flexDirection === 'row')[0];
    expect(styleOf(header).flexShrink).toBe(0);
    if (page === 'more') {
      expect(scroll.findAll(node => node.props.accessibilityLabel === '版本資訊')).toHaveLength(1);
      expect(scroll.findAll(node => String(node.type) === 'Pressable' && String(node.props.accessibilityLabel).startsWith('朗讀速度 '))).toHaveLength(4);
      act(() => { button('朗讀速度 1.5 倍').props.onPress(); });
      expect(onSelectNarrationSpeed).toHaveBeenCalledExactlyOnceWith(1.5);
      expect(text()).toContain('遇到沒有朗讀的章節會停下並提示');
    }
  });

  it('keeps YouVersion, account, versions, reading settings, and speed in More', async () => {
    accountNode = React.createElement('AccountEntryButton');
    loginGateNode = React.createElement('TodayAuthGate');
    updateNode = React.createElement('UpdateBanner');
    canOpenYouVersion = true;
    onOpenYouVersion = vi.fn();
    onSelectNarrationSpeed = vi.fn();
    await mount();
    act(() => { chrome.showTools(); button('更多閱讀工具').props.onPress(); });
    expect(chrome.moreOpen).toBe(true);
    const menu = all('Modal')[0];
    // The backdrop closes the sheet, an unlabelled wrapper swallows taps inside it, then the controls.
    const menuLabels = menu.findAll(node => String(node.type) === 'Pressable').map(node => node.props.accessibilityLabel);
    expect(menuLabels).toContain('選擇譯本');
    expect(menuLabels).toContain('調整字體');
    expect(menuLabels).toContain('選擇其他章節');
    expect(menuLabels).toContain('在 YouVersion 開啟此章');
    expect(menu.findAll(node => node.props.accessibilityLabel === '連讀')).toHaveLength(1);
    expect(menu.findAll(node => String(node.type) === 'AccountEntryButton')).toHaveLength(1);
    expect(menu.findAll(node => String(node.type) === 'TodayAuthGate')).toHaveLength(1);
    expect(menu.findAll(node => String(node.type) === 'UpdateBanner')).toHaveLength(1);
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
    act(() => { chrome.openMore(); });
    await act(async () => { button('在 YouVersion 開啟此章').props.onPress(); await Promise.resolve(); });
    expect(native.pauseAudio).toHaveBeenCalledOnce();
    expect(onOpenYouVersion).toHaveBeenCalledOnce();
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

  it('keeps date, chapter, and More controls actionable without intercepting the reader surface', async () => {
    await mount();
    act(() => { button('上一個排定讀經日').props.onPress(); });
    expect(onSelectDate).toHaveBeenCalledWith(previousDate);
    act(() => { chip('詩91').props.onPress(); });
    expect(onSelectReference).toHaveBeenCalledWith(1);
    act(() => { chip('詩90').props.onPress(); });
    expect(controls.openChapterPicker).toHaveBeenCalledOnce();
    act(() => { chrome.openMore(); });
    act(() => { button('選擇其他章節').props.onPress(); });
    expect(controls.openChapterPicker).toHaveBeenCalledTimes(2);
    expect(surface().props.onTouchEnd).toBeUndefined();
    // Before the reader is ready its own messages sit between the header and ○ ▶, never under them.
    native.safeInsets = { top: 24, bottom: 16, left: 0, right: 0 };
    controls.ready = false;
    act(() => { renderer!.update(React.createElement(Harness)); });
    expect(surface().props.onTouchEnd).toBeUndefined();
    expect(styleOf(surface())).toMatchObject({ paddingTop: 24 + 96, paddingBottom: 49 + 16 + 12 + 56 + 12 });
    expect(button('下一個排定讀經日').props.disabled).not.toBe(true);
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
