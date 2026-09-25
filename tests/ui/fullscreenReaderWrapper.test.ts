import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ back: null as null | (() => boolean), mounts: 0 }));
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const R = require('react') as typeof React;
  return R.createElement(name, props, props.children as React.ReactNode);
});
vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'),
  Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'),
  StyleSheet: { create: (x: unknown) => x },
  BackHandler: { addEventListener: (_: string, callback: () => boolean) => {
    native.back = callback; return { remove: () => { native.back = null; } };
  } },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView') }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: primitive('Icon') }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => ({ addListener: () => ({ remove() {} }) }) }));
vi.mock('../../src/ui/ChapterAudioControls', () => {
  const runtime = require('react') as typeof React;
  return { ChapterAudioAutoplayContext: runtime.createContext(null), ChapterAudioControls: () => null, ChapterAudioAutoplayNotice: () => null, ChapterAudioAutoplayToggle: () => null };
});
vi.mock('../../src/ui/BibleContentPreloadHost', () => ({ BibleContentPreloadHost: () => null }));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => ({ status: 'READER_UI_READY', module: {
  YouVersionProvider: primitive('OfficialProvider'),
  BibleReaderSettingsSheet: primitive('SettingsSheet'),
  BibleChapterPickerSheet: primitive('ChapterSheet'),
  BibleVersionPickerSheet: primitive('VersionSheet'),
  BibleReader: (props: Record<string, unknown>) => {
    React.useEffect(() => { native.mounts++; }, []);
    return React.createElement('OfficialReader', props);
  },
} }) }) }));
import { YouVersionReader } from '../../src/ui/YouVersionReader';

let rendered: TestRenderer.ReactTestRenderer;
let controls: { ready: boolean; openSettings(): void; openChapterPicker(): void; openVersionPicker(): void };
const all = (type: string) => rendered.root.findAll((n) => String(n.type) === type);
const props = {
  date: '2026-09-12', references: ['PSA.90', 'PSA.91'], appKey: 'test-key', versionId: 1392,
  book: 'PSA', chapter: '90', allowedVersionIds: [1392, 312], allowTechnicalProbe: true,
  fullscreen: true,
  renderScreen: (reader: React.ReactNode, next: typeof controls) => { controls = next; return React.createElement('AppScreen', {}, reader); },
};
async function mount(extra = {}) {
  await act(async () => { rendered = TestRenderer.create(React.createElement(YouVersionReader, { ...props, ...extra })); });
}
beforeEach(() => {
  native.mounts = 0; native.back = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { if (rendered) act(() => rendered.unmount()); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('fullscreen official reader wrapper', () => {
  it('uses the SDK production apiHost for all five versions, with the same controlled chapter', async () => {
    vi.stubEnv('EXPO_PUBLIC_QINGMU_API_BASE_URL', 'https://api.luminexhealthbiohack.com');
    await mount({ versionId: 46, book: '1TI', chapter: '1', references: ['1TI.1'], allowedVersionIds: [46, 40, 111, 406, 114] });
    expect(all('OfficialProvider')[0].props.apiHost).toBe('api.luminexhealthbiohack.com');
    expect(all('OfficialProvider')[0].props.hookOverrides).toBeUndefined();
    expect(all('OfficialReader')[0].props).toMatchObject({ versionId: 46, book: '1TI', chapter: '1' });
    expect(controls.ready).toBe(true);
  });
  it('opens an explicit free-browse chapter when the selected day has no assigned references', async () => {
    await mount({ date: '2026-09-13', references: [], book: 'JHN', chapter: '3' });
    expect(all('OfficialReader')).toHaveLength(1);
    expect(all('OfficialReader')[0].props).toMatchObject({ book: 'JHN', chapter: '3', defaultBook: 'JHN', defaultChapter: '3' });
    expect(controls.ready).toBe(true);
  });
  it('allows the verified English selection through the actual provider language filter', async () => {
    await mount({ versionId: 111, allowedVersionIds: [1392, 312, 111] });
    expect(all('OfficialProvider')[0].props.permittedVersionIds).toEqual([1392, 312, 111]);
    expect(all('OfficialProvider')[0].props.permittedLanguageTags).toBeUndefined();
    expect(all('OfficialReader')[0].props.versionId).toBe(111);
  });
  it('renders only scripture, without toolbar, assigned chips, fixed attribution or a card border', async () => {
    await mount();
    expect(all('OfficialReader')[0].props.showToolbar).toBe(false);
    expect(all('Pressable')).toHaveLength(0);
    expect(all('Text')).toHaveLength(0);
    const surface = all('AppScreen')[0].findAll((n) => String(n.type) === 'View')[0];
    expect(surface.props.style.borderWidth ?? 0).toBe(0);
    expect(controls.ready).toBe(true);
  });
  it.each([
    ['openSettings', 'SettingsSheet'], ['openChapterPicker', 'ChapterSheet'], ['openVersionPicker', 'VersionSheet'],
  ] as const)('opens %s and preserves the mounted passage through done, Android Back and public close', async (method, sheet) => {
    await mount();
    const before = all('OfficialReader')[0];
    expect(controls).toBeDefined();
    for (const exit of ['done', 'back', 'public-close']) {
      act(() => controls[method]());
      expect(all(sheet)).toHaveLength(1);
      expect(all(sheet)[0].props.isOpen ?? all(sheet)[0].props.isSettingsSheetOpen).toBe(true);
      expect(all('OfficialProvider')).toHaveLength(1);
      if (exit === 'back') act(() => { expect(native.back?.()).toBe(true); });
      else if (exit === 'public-close') act(() => all(sheet)[0].props.onClose());
      else act(() => all('Pressable').find((n) => n.props.accessibilityLabel === '完成設定，返回閱讀')!.props.onPress());
      expect(all(sheet)).toHaveLength(1);
      expect(all(sheet)[0].props.isOpen ?? all(sheet)[0].props.isSettingsSheetOpen).toBe(false);
      expect(all('OfficialReader')[0]).toBe(before);
      expect(native.mounts).toBe(1);
      expect(native.back).toBeNull();
    }
  });
  it('uses official selection payloads in book/chapter/version order and rejects unapproved versions', async () => {
    const calls: unknown[] = [];
    await mount({ onBookChange: (v: string) => calls.push(['book', v]), onChapterChange: (v: string) => calls.push(['chapter', v]), onVersionChange: (v: number) => calls.push(['version', v]) });
    expect(controls).toBeDefined();
    act(() => controls.openChapterPicker());
    expect(all('ChapterSheet')[0].props).toMatchObject({ book: 'PSA', chapter: '90', versionId: 1392, isOpen: true });
    await act(async () => all('ChapterSheet')[0].props.onSelect({ book: 'GEN', chapter: '1', versionId: 999 }));
    expect(calls).toEqual([]);
    await act(async () => all('ChapterSheet')[0].props.onSelect({ book: 'JHN', chapter: '2', versionId: 312 }));
    expect(calls).toEqual([['book', 'JHN'], ['chapter', '2'], ['version', 312]]);
    act(() => controls.openVersionPicker());
    await act(async () => all('VersionSheet')[0].props.onSelect(999));
    expect(calls).toHaveLength(3);
    act(() => controls.openVersionPicker());
    await act(async () => all('VersionSheet')[0].props.onSelect(1392));
    expect(calls.at(-1)).toEqual(['version', 1392]);
    expect(native.mounts).toBe(1);
  });
  it('keeps fallback controls safe and the host return surface available while unconfigured', async () => {
    await mount({ appKey: null });
    expect(all('AppScreen')).toHaveLength(1);
    expect(controls?.ready).toBe(false);
    expect(() => { controls.openSettings(); controls.openChapterPicker(); controls.openVersionPicker(); }).not.toThrow();
    expect(all('SettingsSheet')).toHaveLength(0);
  });
  it('only removes SDK footer when the current version has metadata for the host information panel', async () => {
    await mount();
    expect(all('OfficialReader')[0].props.dom.injectedJavaScript).toContain('main > footer');
    await act(async () => rendered.update(React.createElement(YouVersionReader, { ...props, versionId: 999, allowedVersionIds: [999] })));
    expect(all('OfficialReader')[0].props.dom.injectedJavaScript).not.toContain('main > footer');
    expect(native.mounts).toBe(1);
  });
  it('reports whether a verse is selected and hands the clear signal to the official reader', async () => {
    const selection = vi.fn();
    await mount({ onVerseSelectionChange: selection, clearVerseSelectionSignal: 3 });
    const reader = all('OfficialReader')[0];
    expect(reader.props.clearSelectionSignal).toBe(3);
    await act(async () => { await reader.props.onVerseSelect({ verses: [10], reference: '提多書 2:10' }); });
    await act(async () => { await reader.props.onVerseSelect({ verses: [], reference: '' }); });
    expect(selection.mock.calls).toEqual([[true], [false]]);
  });
  it('forwards only valid local canvas messages and keeps legacy mode untouched', async () => {
    const reveal = vi.fn(), scroll = vi.fn(), edge = vi.fn();
    await mount({ onCanvasReveal: reveal, onCanvasScroll: scroll, onCanvasEdge: edge });
    const dom = all('OfficialReader')[0].props.dom;
    const send = (message: unknown) => dom.onMessage({ nativeEvent: { data: JSON.stringify(message) } });
    act(() => {
      send({ type: 'qingmu.reader.canvas.reveal', data: { reason: 'top' } });
      send({ type: 'qingmu.reader.canvas.reveal', data: { reason: 'tap' } });
      send({ type: 'qingmu.reader.canvas.reveal', data: { reason: 'sideways' } });
      send({ type: 'qingmu.reader.canvas.scroll', data: { direction: 'down', deltaY: 20 } });
      send({ type: 'qingmu.reader.canvas.edge', data: { atEnd: true } });
      send({ type: 'qingmu.reader.canvas.edge', data: { atEnd: 'yes' } });
      send({ type: 'qingmu.reader.canvas.tap', data: null });
    });
    expect(reveal).toHaveBeenCalledExactlyOnceWith('top');
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ direction: 'down', deltaY: 20 });
    expect(edge).toHaveBeenCalledExactlyOnceWith({ atEnd: true });
    await act(async () => rendered.update(React.createElement(YouVersionReader, { ...props, fullscreen: false, onCanvasReveal: reveal })));
    expect(all('OfficialReader')[0].props.showToolbar).toBe(true);
    expect(all('Pressable').length).toBeGreaterThan(0);
  });
});

describe('injected canvas gesture bridge', () => {
  it('asks to collapse again on a new downward gesture after a pause and never intercepts a scripture tap', async () => {
    await mount();
    const listeners = new Map<string, ((event: any) => void)[]>();
    const postMessage = vi.fn();
    let now = 1000;
    const document = {
      documentElement: { setAttribute: vi.fn() }, getElementById: () => null, head: { appendChild: vi.fn() }, createElement: () => ({}),
      querySelector: () => null, querySelectorAll: () => [], body: {},
      addEventListener: (type: string, callback: (event: any) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), callback]); },
    };
    const window = { ReactNativeWebView: { postMessage } };
    class MutationObserver { observe() { /* layout pass is covered by the Chromium test */ } }
    runInNewContext(all('OfficialReader')[0].props.dom.injectedJavaScript, { document, window, Date: { now: () => now }, MutationObserver, Node: { DOCUMENT_POSITION_PRECEDING: 2 }, setTimeout: () => 0 });
    expect(listeners.has('pointerdown')).toBe(false);
    const dispatch = (name: string, e: any) => { for (const listener of listeners.get(name) ?? []) listener(e); };
    let scrollTop = 0;
    const container = { closest: () => ({}), get scrollTop() { return scrollTop; }, clientHeight: 600, scrollHeight: 6000 };
    const scrollBy = (dy: number, after = 16) => { now += after; scrollTop += dy; dispatch('scroll', { target: container }); };
    const messages = () => postMessage.mock.calls.map(([raw]) => JSON.parse(raw)).filter(m => m.type !== 'qingmu.reader.canvas.edge');
    const down = (deltaY: number) => ({ type: 'qingmu.reader.canvas.scroll', data: { direction: 'down', deltaY } });

    scrollBy(200); scrollBy(100); scrollBy(100);
    expect(messages()).toEqual([down(200)]);
    // Native revealed on its own (Back or the collapsed bar); the next gesture after a pause collapses again.
    scrollBy(100, 900);
    expect(messages()).toEqual([down(200), down(100)]);

    const verse = { closest: (selector: string) => (selector.includes('aria-label="設定"') ? null : {}) };
    const tap = { target: verse, button: 0, detail: 1, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    dispatch('click', tap);
    expect(tap.preventDefault).not.toHaveBeenCalled();
    expect(tap.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(messages()).toHaveLength(2);
  });
});
