import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReaderSettingsSdk } from '../helpers/loadReaderSettingsSdk';
import { createReaderPreferencesStore, type ReaderPreferencesStore } from '../../src/services/readerPreferences';
import type { ReaderSettingsSnapshot } from '@youversion/platform-react-native-expo-ui';

const boundary = vi.hoisted(() => ({ module: null as any, mounts: 0, renders: [] as { owner: string | null; settings: ReaderSettingsSnapshot }[], listeners: [] as ((snapshot: ReaderSettingsSnapshot) => void)[] }));
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const R = require('react') as typeof React;
  return R.createElement(name, props, props.children as React.ReactNode);
});
vi.mock('react-native', () => ({ ActivityIndicator: primitive('ActivityIndicator'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), StyleSheet: { create: (x: unknown) => x }, BackHandler: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView') }));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => ({ status: 'READER_UI_READY', module: boundary.module }) }) }));
import { YouVersionReader, type ReaderOverlayControls } from '../../src/ui/YouVersionReader';

const Owner = React.createContext<string | null>(null);
let sdk: ReturnType<typeof loadReaderSettingsSdk>;
let renderer: TestRenderer.ReactTestRenderer;
let store: ReaderPreferencesStore;
let memory: Map<string, string>;
let controls: ReaderOverlayControls;
let saves: { owner: string | null; settings: ReaderSettingsSnapshot }[];
let switchOwner: (owner: string | null) => void;
const options = { allowedVersionIds: [1392, 312], defaultVersionId: 1392 };
const storage = () => ({ getItem: async (key: string) => memory.get(key) ?? null, setItem: async (key: string, value: string) => { memory.set(key, value); } });
const currentSettings = (): ReaderSettingsSnapshot => sdk.api.getReaderSettings();
const readerProps = { date: '2026-09-12', references: ['PSA.90'], appKey: 'test-key', versionId: 1392, book: 'PSA', chapter: '90', allowedVersionIds: [1392, 312], allowTechnicalProbe: true, fullscreen: true, renderScreen: (reader: React.ReactNode, next: ReaderOverlayControls) => { controls = next; return reader; } };
function Harness({ initialOwner }: { initialOwner: string | null }) {
  const [owner, setOwner] = React.useState(initialOwner);
  switchOwner = setOwner;
  const snapshot = React.useSyncExternalStore(store.subscribe, () => store.getSnapshot(owner));
  return React.createElement(Owner.Provider, { value: owner }, React.createElement(YouVersionReader, { ...readerProps, readerPreferences: {
    ownerId: owner, settings: snapshot.preferences.settings,
    onChange(next: ReaderSettingsSnapshot) { saves.push({ owner, settings: { ...next } }); void store.update(owner, { settings: next }); },
  } }));
}
const shown = () => renderer.root.findAll(node => String(node.type) === 'OfficialReader');
async function mount(owner: string | null = 'A') {
  await act(async () => { renderer = TestRenderer.create(React.createElement(Harness, { initialOwner: owner })); });
}
beforeEach(() => {
  sdk = loadReaderSettingsSdk(); memory = new Map(); saves = [];
  store = createReaderPreferencesStore(storage(), options);
  boundary.mounts = 0; boundary.renders = []; boundary.listeners = [];
  boundary.module = { ...sdk.api,
    subscribeReaderSettings: (listener: (snapshot: ReaderSettingsSnapshot) => void) => { boundary.listeners.push(listener); return sdk.api.subscribeReaderSettings(listener); },
    YouVersionProvider: primitive('OfficialProvider'), BibleReaderSettingsSheet: primitive('SettingsSheet'), BibleChapterPickerSheet: primitive('ChapterSheet'), BibleVersionPickerSheet: primitive('VersionSheet'),
    BibleReader: (props: Record<string, unknown>) => {
      const state = sdk.actualStore(); const owner = React.useContext(Owner);
      const settings = { fontSize: state.fontSize, fontFamily: state.fontFamily, lineSpacing: state.lineSpacing };
      boundary.renders.push({ owner, settings }); React.useEffect(() => { boundary.mounts++; }, []);
      return React.createElement('OfficialReader', { ...props, settings });
    },
  };
  vi.spyOn(console, 'error').mockImplementation((...args) => { const message = String(args[0] ?? ''); if (!message.includes('react-test-renderer is deprecated') && !message.includes('testing environment is not configured to support act')) throw new Error(message); });
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.restoreAllMocks(); });

describe('account preferences through the real caller, SDK store and app persistence', () => {
  it('restores A, saves an official UI setter change, and restores it after app-store/Reader recreation', async () => {
    const a = { fontSize: 20, fontFamily: sdk.fonts.INTER_FONT, lineSpacing: 2 };
    await store.update('A', { settings: a }); await mount();
    expect(shown()[0].props.settings).toEqual(a);
    expect(saves).toEqual([]);
    await act(async () => boundary.listeners.at(-1)!(currentSettings()));
    expect(saves, 'An applied/current snapshot echoed by a queued callback is not a new user edit').toEqual([]);
    await act(async () => sdk.actualStore.getState().setFontSize(18));
    expect(saves).toEqual([{ owner: 'A', settings: { ...a, fontSize: 18 } }]);
    expect(store.getSnapshot('A').preferences.settings?.fontSize).toBe(18);
    act(() => renderer.unmount());
    store = createReaderPreferencesStore(storage(), options); await store.load('A');
    sdk.api.setReaderSettings(sdk.api.getDefaultReaderSettings()); saves = [];
    await mount();
    expect(shown()[0].props.settings).toEqual({ ...a, fontSize: 18 }); expect(saves).toEqual([]);
  });
  it('gates B until its defaults are applied, keeps A/B isolated and rejects retired A callbacks', async () => {
    const a = { fontSize: 20, fontFamily: sdk.fonts.INTER_FONT, lineSpacing: 2 };
    await store.update('A', { settings: a }); await store.load('B'); await mount();
    const retiredA = boundary.listeners.at(-1);
    expect(retiredA, 'Account binding must subscribe to official SDK settings').toBeTypeOf('function');
    await act(async () => switchOwner('B'));
    const defaults = sdk.api.getDefaultReaderSettings();
    expect(shown()[0].props.settings).toEqual(defaults);
    expect(boundary.renders.filter(item => item.owner === 'B').every(item => JSON.stringify(item.settings) === JSON.stringify(defaults))).toBe(true);
    expect(saves).toEqual([]);
    await act(async () => retiredA!({ ...a, fontSize: 12 }));
    expect(saves).toEqual([]); expect(store.getSnapshot('B').preferences.settings).toBeNull();
    await act(async () => sdk.actualStore.getState().setLineSpacing(1.45));
    expect(saves.at(-1)?.owner).toBe('B');
    await act(async () => switchOwner('A'));
    expect(shown()[0].props.settings).toEqual(a);
    await act(async () => retiredA!({ ...a, fontSize: 12 }));
    expect(store.getSnapshot('A').preferences.settings).toEqual(a);
  });
  it('applies same-owner updates and normalization without remount or save feedback', async () => {
    await store.update('A', { settings: { fontSize: 24, fontFamily: sdk.fonts.INTER_FONT, lineSpacing: 1.8 } }); await mount();
    expect(shown()[0].props.settings).toEqual({ fontSize: 20, fontFamily: sdk.fonts.INTER_FONT, lineSpacing: 1.7 });
    expect(saves).toEqual([]);
    const originalReader = shown()[0];
    await act(async () => store.update('A', { settings: { fontSize: 14, fontFamily: sdk.fonts.UNTITLED_SERIF_FONT, lineSpacing: 2 } }));
    expect(shown()[0]).toBe(originalReader); expect(boundary.mounts).toBe(1); expect(saves).toEqual([]);
    await act(async () => sdk.actualStore.getState().setFontSize(18));
    expect(saves).toHaveLength(1); expect(boundary.mounts).toBe(1);
    act(() => controls.openSettings());
    act(() => renderer.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '完成設定，返回閱讀')[0].props.onPress());
    expect(shown()[0]).toBe(originalReader);
  });
  it('uses SDK defaults for guest and does not inherit the previous account settings', async () => {
    await store.update('A', { settings: { fontSize: 20, fontFamily: sdk.fonts.INTER_FONT, lineSpacing: 2 } }); await mount();
    await act(async () => switchOwner(null));
    expect(shown()[0].props.settings).toEqual(sdk.api.getDefaultReaderSettings());
    expect(saves).toEqual([]);
  });
  it('reports a missing extension honestly and never renders account content as ready', async () => {
    delete boundary.module.setReaderSettings;
    await store.load('A'); await mount();
    expect(shown()).toHaveLength(0); expect(controls.ready).toBe(false);
    expect(renderer.root.findAll(node => node.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
  });
  it('retains legacy behavior when readerPreferences is omitted', async () => {
    sdk.api.setReaderSettings({ fontSize: 20 }); const before = currentSettings();
    await act(async () => { renderer = TestRenderer.create(React.createElement(YouVersionReader, readerProps)); });
    expect(shown()[0].props.settings).toEqual(before); expect(boundary.listeners).toHaveLength(0);
  });
});
