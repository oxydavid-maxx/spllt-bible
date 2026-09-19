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
  it('forwards only valid local canvas messages and keeps legacy mode untouched', async () => {
    const tap = vi.fn(), scroll = vi.fn();
    await mount({ onCanvasTap: tap, onCanvasScroll: scroll });
    const dom = all('OfficialReader')[0].props.dom;
    act(() => {
      for (const type of ['qingmu.reader.canvas.tap', 'qingmu.reader.canvas.scroll']) dom.onMessage({ nativeEvent: { data: JSON.stringify({ type, data: null }) } });
      dom.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'qingmu.reader.canvas.tap', data: 'content' }) } });
    });
    expect(tap).toHaveBeenCalledOnce(); expect(scroll).toHaveBeenCalledOnce();
    await act(async () => rendered.update(React.createElement(YouVersionReader, { ...props, fullscreen: false, onCanvasTap: tap })));
    expect(all('OfficialReader')[0].props.showToolbar).toBe(true);
    expect(all('Pressable').length).toBeGreaterThan(0);
  });
});

describe('injected canvas gesture bridge', () => {
  it('consumes a quick plain-scripture tap but preserves controls, footnotes, selections, long presses and scroll drags', async () => {
    await mount();
    const listeners = new Map<string, ((event: any) => void)[]>();
    const postMessage = vi.fn();
    let now = 1000, selection = '';
    const document = { documentElement: { setAttribute: vi.fn() }, getElementById: () => null, head: { appendChild: vi.fn() }, createElement: () => ({}), addEventListener: (type: string, callback: (event: any) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), callback]); } };
    const window = { ReactNativeWebView: { postMessage }, getSelection: () => ({ toString: () => selection }) };
    runInNewContext(all('OfficialReader')[0].props.dom.injectedJavaScript, { document, window, Date: { now: () => now } });
    expect(listeners.has('pointerdown')).toBe(true);
    const dispatch = (name: string, e: any) => {
      for (const listener of listeners.get(name) ?? []) {
        listener(e);
        if (e.stopImmediatePropagation?.mock.calls.length) break;
      }
    };
    const target = (interactive = false) => ({ closest: (selector: string) => selector.includes('aria-label="設定"') ? null : selector.includes('button,a,') ? (interactive ? {} : null) : {} });
    const event = (t = target()) => ({ target: t, button: 0, isPrimary: true, clientX: 10, clientY: 10, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    const quickTap = (e: ReturnType<typeof event>, delay = 80) => { dispatch('pointerdown', e); now += delay; dispatch('click', e); };
    const tap = event(); quickTap(tap);
    expect(tap.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([{ type: 'qingmu.reader.canvas.tap', data: null }]);
    const button = event(target(true)); quickTap(button); expect(button.preventDefault).not.toHaveBeenCalled();
    const long = event(); quickTap(long, 700); expect(long.preventDefault).not.toHaveBeenCalled();
    selection = 'selected verse'; const selected = event(); quickTap(selected); expect(selected.preventDefault).not.toHaveBeenCalled(); selection = '';
    const drag = event(); dispatch('pointerdown', drag); dispatch('pointermove', { ...drag, clientY: 50 }); now += 80; dispatch('click', drag); expect(drag.preventDefault).not.toHaveBeenCalled();
    const cancelled = event(); dispatch('pointerdown', cancelled); dispatch('pointercancel', cancelled); dispatch('click', cancelled); expect(cancelled.preventDefault).not.toHaveBeenCalled();
    const double = { ...event(), detail: 2 }; quickTap(double); expect(double.preventDefault).not.toHaveBeenCalled();
    dispatch('scroll', event());
    expect(JSON.parse(postMessage.mock.calls.at(-1)![0])).toEqual({ type: 'qingmu.reader.canvas.scroll', data: null });
  });
});
