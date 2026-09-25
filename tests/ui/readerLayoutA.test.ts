import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Layout A (docs/design/reader-page.md §5, §5.1): chips for today's chapters on top, ○ ▶ at the
// bottom-right, immersive collapses the header in place and keeps ▶ where it was.
const native = vi.hoisted(() => ({
  focus: null as null | (() => void), blur: null as null | (() => void),
  screenReader: false,
  backHandlers: [] as Array<() => boolean>,
  setNavigationHidden: vi.fn(), setNavigationStyle: vi.fn(),
  safeInsets: { top: 65.5, bottom: 48, left: 0, right: 0 },
  window: { width: 411, fontScale: 1 },
}));
vi.mock('react-native', () => ({
  TextInput: 'TextInput', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Modal: (props: any) => props.visible ? React.createElement('Modal', props, props.children) : null,
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  Appearance: { getColorScheme: () => 'light' }, useColorScheme: () => 'light',
  useWindowDimensions: () => native.window,
  Linking: { openURL: vi.fn(async () => undefined) },
  BackHandler: { addEventListener: (_name: string, handler: () => boolean) => { native.backHandlers.push(handler); return { remove: () => { native.backHandlers = native.backHandlers.filter(h => h !== handler); } }; } },
  AccessibilityInfo: { isScreenReaderEnabled: async () => native.screenReader, addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: (props: any) => React.createElement('MaterialCommunityIcons', props) }));
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
vi.mock('../../src/ui/ChapterAudioControls', () => ({ ChapterAudioAutoplayNotice: () => null, ChapterAudioAutoplayToggle: () => null, ChapterAudioControls: React.forwardRef((props: any, ref: any) => {
  React.useImperativeHandle(ref, () => ({ pause: async () => undefined }));
  return React.createElement('Pressable', { accessibilityRole: 'button', accessibilityLabel: '播放', style: { width: 56, height: 56 } });
}) }));

import { FullscreenReaderLayout, readerCanvasInsets, useReaderChrome } from '../../src/ui/FullscreenReaderLayout';
import type { ReaderOverlayControls } from '../../src/ui/YouVersionReader';

let chrome: ReturnType<typeof useReaderChrome>;
let renderer: TestRenderer.ReactTestRenderer | null = null;
let references = ['TIT.1', 'PSA.99', 'PSA.100'];
let currentChapter = 'TIT.1';
let selectionSource: 'ASSIGNED' | 'FREE' = 'ASSIGNED';
let activeReferenceIndex = 0;
let completed = false;
const onSelectReference = vi.fn();
const onComplete = vi.fn();
const controls: ReaderOverlayControls = { ready: true, openChapterPicker: vi.fn(), openVersionPicker: vi.fn(), openSettings: vi.fn() };

function Harness() {
  chrome = useReaderChrome();
  return React.createElement(FullscreenReaderLayout, {
    reader: React.createElement('BibleReader'), controls, chrome, chapterUsfm: currentChapter, versionId: 46, references,
    selectionSource, activeReferenceIndex, onSelectReference, selectedDate: '2026-09-24', previousDate: '2026-09-23', nextDate: '2026-09-25',
    onSelectDate: vi.fn(), completed, onComplete, onUndo: vi.fn(),
    metadata: { translationName: '新標點和合本', publisher: '聯合聖經公會', copyrightNotice: '版權', officialUrl: 'https://example.test' },
  });
}
const all = (type: string) => renderer!.root.findAll(node => String(node.type) === type);
const pressable = (label: string) => all('Pressable').find(node => node.props.accessibilityLabel === label);
const styleOf = (node: TestRenderer.ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
const texts = () => all('Text').map(node => [node.props.children].flat().join(''));
const header = () => all('SafeAreaView').find(node => node.props.accessibilityLabel === '閱讀工具列');
const actionRow = () => all('View').find(node => node.props.accessibilityLabel === '讀經動作')!;
const readerSurface = () => all('View').find(node => node.findAll(child => String(child.type) === 'BibleReader').length > 0 && node.props.accessibilityLabel === '經文')!;
async function mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(Harness)); }); }
async function rerender() { await act(async () => { renderer!.update(React.createElement(Harness)); }); }
const collapse = () => act(() => { chrome.handleCanvasScroll({ direction: 'down', deltaY: 40 }); });

describe('reader layout A', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T04:00:00Z'));
    native.backHandlers = []; native.screenReader = false;
    native.safeInsets = { top: 65.5, bottom: 48, left: 0, right: 0 };
    native.window = { width: 411, fontScale: 1 };
    references = ['TIT.1', 'PSA.99', 'PSA.100']; currentChapter = 'TIT.1'; selectionSource = 'ASSIGNED'; activeReferenceIndex = 0; completed = false;
    onSelectReference.mockClear(); onComplete.mockClear();
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

  it('shows today\'s chapters as abbreviated chips with the current one selected, and a chip press selects that chapter', async () => {
    await mount();
    const chips = all('Pressable').filter(node => String(node.props.accessibilityLabel ?? '').includes('今日第'));
    expect(chips.map(node => node.findAll(child => String(child.type) === 'Text').map(t => t.props.children).join(''))).toEqual(['多1', '詩99', '詩100']);
    expect(chips.map(node => node.props.accessibilityState?.selected)).toEqual([true, false, false]);
    expect(chips[1].props.accessibilityLabel).toContain('詩篇');
    act(() => { chips[1].props.onPress(); });
    expect(onSelectReference).toHaveBeenCalledWith(1);
    expect(styleOf(chips[0]).minHeight).toBeGreaterThanOrEqual(48);
  });

  it('shows a selected free-reading chip first while browsing outside today\'s range', async () => {
    selectionSource = 'FREE'; currentChapter = 'GEN.1'; activeReferenceIndex = -1;
    await mount();
    const chipTexts = all('Pressable').filter(node => node.props.accessibilityState && 'selected' in node.props.accessibilityState)
      .map(node => ({ text: node.findAll(c => String(c.type) === 'Text').map(t => t.props.children).join(''), selected: node.props.accessibilityState.selected }));
    expect(chipTexts[0]).toEqual({ text: '自由 創1', selected: true });
    expect(chipTexts.slice(1).every(chip => chip.selected === false)).toBe(true);
  });

  it('keeps the dated first row and puts the chips with More in the second header row', async () => {
    await mount();
    expect(header()).toBeDefined();
    expect(texts()).toContain('今天·9/24（四）');
    expect(pressable('更多閱讀工具')).toBeDefined();
    const dateTitle = all('Text').find(node => node.props.children === '今天·9/24（四）')!;
    expect(styleOf(dateTitle)).toMatchObject({ fontSize: 16 });
  });

  it('puts completion and play at the bottom-right, both 56dp, 12dp apart on one line', async () => {
    await mount();
    const row = actionRow();
    expect(styleOf(row)).toMatchObject({ position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 12 });
    expect(styleOf(row).right).toBeGreaterThanOrEqual(8);
    const completion = pressable('完成讀經')!;
    expect(styleOf(completion)).toMatchObject({ width: 56, height: 56 });
    expect(pressable('播放')).toBeDefined();
    expect(row.findAll(node => node === completion)).toHaveLength(1);
  });

  it('collapses the header in place into a progress bar while reading down, hides completion and keeps play exactly where it was', async () => {
    await mount();
    const before = styleOf(actionRow());
    collapse();
    expect(header()).toBeUndefined();
    const bar = pressable('展開閱讀工具')!;
    expect(bar).toBeDefined();
    expect(styleOf(bar)).toMatchObject({ position: 'absolute', top: 0, height: 48 });
    const barTexts = bar.findAll(node => String(node.type) === 'Text').map(node => node.props.children);
    expect(barTexts).toEqual(expect.arrayContaining(['多1', '1/3']));
    expect(pressable('完成讀經')).toBeUndefined();
    expect(pressable('播放')).toBeDefined();
    expect({ right: styleOf(actionRow()).right, bottom: styleOf(actionRow()).bottom }).toEqual({ right: before.right, bottom: before.bottom });
  });

  it('reveals from the collapsed bar, a reveal message, and Android Back; Back is left alone while the tools are visible', async () => {
    await mount();
    expect(native.backHandlers).toHaveLength(0);
    collapse();
    act(() => { pressable('展開閱讀工具')!.props.onPress(); });
    expect(header()).toBeDefined();
    collapse();
    act(() => { chrome.revealTools('up'); });
    expect(header()).toBeDefined();
    collapse();
    expect(native.backHandlers).toHaveLength(1);
    let consumed = false;
    act(() => { consumed = native.backHandlers[0](); });
    expect(consumed).toBe(true);
    expect(header()).toBeDefined();
    expect(native.backHandlers).toHaveLength(0);
  });

  it('shows the system bars normally and hides them only while collapsed', async () => {
    await mount();
    expect(all('StatusBar')[0].props.hidden).toBe(false);
    collapse();
    expect(all('StatusBar')[0].props.hidden).toBe(true);
  });

  it('offers the next chapter at a chapter end and expands completion at the end of the last chapter until it is done', async () => {
    await mount();
    act(() => { chrome.handleCanvasEdge({ atEnd: true }); });
    const next = all('Pressable').find(node => String(node.props.accessibilityLabel ?? '').startsWith('繼續讀'))!;
    expect(next).toBeDefined();
    expect(next.findAll(n => String(n.type) === 'Text').map(t => t.props.children).join('')).toBe('繼續讀 詩99 ›');
    act(() => { next.props.onPress(); });
    expect(onSelectReference).toHaveBeenCalledWith(1);
    expect(texts()).not.toContain('完成今日讀經');

    activeReferenceIndex = 2; currentChapter = 'PSA.100';
    await rerender();
    act(() => { chrome.handleCanvasEdge({ atEnd: true }); });
    expect(all('Pressable').some(node => String(node.props.accessibilityLabel ?? '').startsWith('繼續讀'))).toBe(false);
    expect(texts()).toContain('完成今日讀經');
    act(() => { pressable('完成讀經')!.props.onPress(); });
    expect(onComplete).toHaveBeenCalledOnce();

    completed = true;
    await rerender();
    expect(texts()).not.toContain('完成今日讀經');
  });

  it('keeps the scripture surface identical between normal and collapsed, and reserves room under the overlays', async () => {
    await mount();
    const normal = styleOf(readerSurface());
    collapse();
    expect(styleOf(readerSurface())).toEqual(normal);
    expect(normal.paddingTop ?? 0).toBe(0);
    expect(normal.paddingBottom ?? 0).toBe(0);
    expect(readerCanvasInsets({ top: 65.5, bottom: 48 })).toEqual({ top: 174, bottom: 241 });
  });
});
