import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { create } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ module: null as any, readerMounts: 0, back: null as null | (() => boolean) }));
// React Native's Animated is the only animation double (tests/doubles/animatedDouble.cjs); the sheet
// itself is the app's real one that Metro serves for '@gorhom/bottom-sheet'.
const animated = vi.hoisted(() => (require('../doubles/animatedDouble.cjs') as { createAnimatedDouble(): any }).createAnimatedDouble());
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const R = require('react') as typeof React;
  return R.createElement(name, props, props.children as React.ReactNode);
});
const rn = vi.hoisted(() => ({
  ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'),
  Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'),
  ...animated.modules(primitive),
  Platform: { OS: 'android' as 'android' | 'ios' }, useWindowDimensions: () => ({ width: 390, height: 844 }),
  StyleSheet: { create: (x: unknown) => x, flatten: (x: unknown) => Object.assign({}, ...[x].flat(Infinity)), absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
  BackHandler: { addEventListener: (_: string, cb: () => boolean) => { boundary.back = cb; return { remove: () => { boundary.back = null; } }; } },
}));
vi.mock('react-native', () => rn);
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView'), useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) }));
// The reader's content preloader imports the YouVersion core package, whose index loads react-native-mmkv
// and Nitro, i.e. react-native's own Flow source, which node cannot parse. Same stand-in as the other reader tests.
vi.mock('@youversion/platform-react-native-expo-core', () => ({ useYouVersion: () => ({ fetchBibleContent: async () => ({ content: '' }) }) }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => ({ status: 'READER_UI_READY', module: boundary.module }) }) }));
import { YouVersionReader, type ReaderOverlayControls } from '../../src/ui/YouVersionReader';
import * as appSheet from '../../src/ui/sheet/bottomSheet';

const finishAnimations = () => act(() => { animated.finishAll(); });
const leanSheets = () => renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'lean-bottom-sheet');
const sheetOf = (kind: string) => leanSheets().find(node => node.findAll(child => child.type === kind).length > 0)!;
const isOpen = (sheet: TestRenderer.ReactTestInstance) => sheet.props.pointerEvents === 'auto';
// On device the DOM WebView content reports its height through BottomSheetView's onLayout.
const deliverNativeLayouts = () => act(() => {
  for (const sheet of leanSheets()) {
    const content = sheet.findAll(node => (node.type as unknown) === 'View' && typeof node.props.onLayout === 'function' && node.props.testID === undefined)[0];
    content?.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
  }
});
function loadInstalledSheets() {
  const registry = new Map<string, any>([['BibleReaderSettings', 'SettingsDom'], ['ChapterPickerContent', 'ChapterDom'], ['BibleVersionPickerContent', 'VersionDom']]);
  const settings = { fontSize: 20, fontFamily: 'serif', lineSpacing: 'normal', setFontFamily() {}, setFontSize() {}, setLineSpacing() {} };
  const settingsStore = Object.assign(() => settings, { getState: () => settings });
  const dependencies: Record<string, any> = {
    'react': React, 'react/jsx-runtime': jsxRuntime, 'react-native': rn, 'zustand': { create },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 24 }) },
    '@gorhom/bottom-sheet': { __esModule: true, ...appSheet },
    '@rn-primitives/portal': { Portal: primitive('Portal'), PortalHost: primitive('PortalHost') },
    '@youversion/platform-react-native-expo-core': { useYouVersion: () => ({ appKey: 'test-key', permittedVersionIds: [1392, 312] }) },
    '@youversion/platform-react-ui': { createBibleThemeSettingsContentHandlers: () => ({}) },
    '../lib/native-sheet-max-width': { sheetHorizontalMargin: () => 0 },
    '../lib/native-sheet-theme': { SHEET_HANDLE: { light: '#aaa' }, SHEET_SURFACE: { light: '#fff' }, SHEET_TOP_SHADOW: { light: {} }, SHEET_MUTED_BACKGROUND: { light: '#fff' } },
    '../i18n/use-sdk-translation': { useSdkTranslation: () => ({ t: (x: string) => x }) },
    '../hooks/use-theme': { useTheme: () => 'light' }, '../i18n/locale-context': { useLocale: () => ({ lng: 'zh' }) },
    '../lib/constants': { DEFAULT_BIBLE_VERSION_ID: 1392 }, '../lib/embed-dom-props': { withSheetDomDefaults: () => ({}) },
    '../lib/reader-fonts': { encodeFontFamilyForDom: (x: string) => x }, '../stores/reader-settings-store': { useReaderSettingsStore: settingsStore },
    './component-impls': { registerDefault: (key: string, value: unknown) => registry.set(key, value), getImpl: (key: string) => { if (!registry.has(key)) throw new Error(`Missing official impl ${key}`); return registry.get(key); } },
  };
  function evaluate(name: string) {
    const source = readFileSync(`node_modules/@youversion/platform-react-native-expo-ui/build/native/${name}.js`, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    new Function('require', 'exports', compiled)((id: string) => { if (!(id in dependencies)) throw new Error(`Unbound SDK dependency: ${id}`); return dependencies[id]; }, exports);
    return exports as any;
  }
  const nativeSheet = evaluate('native-sheet');
  dependencies['./native-sheet'] = nativeSheet;
  return { ...nativeSheet, ...evaluate('bible-reader-settings-sheet'), ...evaluate('bible-chapter-picker-sheet'), ...evaluate('bible-version-picker-sheet') };
}

let renderer: TestRenderer.ReactTestRenderer;
let sheetReports: boolean[] = [];
let controls: ReaderOverlayControls;
let installed: ReturnType<typeof loadInstalledSheets>;
async function mountReader() {
  await act(async () => { renderer = TestRenderer.create(React.createElement(YouVersionReader, {
    date: '2026-09-12', references: ['PSA.90'], appKey: 'test-key', versionId: 1392, book: 'PSA', chapter: '90',
    allowedVersionIds: [1392, 312], allowTechnicalProbe: true, fullscreen: true,
    renderScreen: (reader, next) => { controls = next; return reader; },
    onSheetOpenChange: (open: boolean) => { sheetReports.push(open); },
  })); });
}
beforeEach(() => {
  animated.reset(); boundary.readerMounts = 0; boundary.back = null; sheetReports = [];
  installed = loadInstalledSheets();
  boundary.module = { ...installed, YouVersionProvider: installed.NativeSheetProvider,
    BibleReader: (props: Record<string, unknown>) => { React.useEffect(() => { boundary.readerMounts++; }, []); return React.createElement('OfficialReader', props); },
  };
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    const message = String(args[0] ?? '');
    if (!message.includes('react-test-renderer is deprecated') && !message.includes('testing environment is not configured to support act')) throw new Error(message);
  });
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.restoreAllMocks(); });

// The SDK's native-sheet.js takes a different branch per platform (suppressInactiveSheet is Android-only; iOS keeps
// inactive sheets mounted and visible to pre-warm them), so the same lifecycle runs on both.
describe.each(['android', 'ios'] as const)('installed SDK sheets on the app-owned bottom sheet (%s)', (os) => {
  beforeEach(() => { rn.Platform.OS = os; });
  afterEach(() => { rn.Platform.OS = 'android'; });
  it('opens a sheet whose SDK open request arrived before its content was measured', async () => {
    await act(async () => { renderer = TestRenderer.create(React.createElement(installed.BibleReaderSettingsSheet, { isSettingsSheetOpen: true, onClose() {} })); });
    expect(isOpen(leanSheets()[0])).toBe(false);
    deliverNativeLayouts();
    finishAnimations();
    expect(isOpen(leanSheets()[0])).toBe(true);
  });
  it.each([
    ['openSettings', 'SettingsDom'], ['openChapterPicker', 'ChapterDom'], ['openVersionPicker', 'VersionDom'],
  ] as const)('opens %s and keeps that host mounted through done / back / backdrop dismissals', async (method, kind) => {
    await mountReader();
    const inertHosts = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'native-sheet-inert-host');
    if (os === 'android') {
      expect(inertHosts).toHaveLength(3);
      expect(inertHosts.every(node => node.props.pointerEvents === 'none' && node.props.importantForAccessibility === 'no-hide-descendants')).toBe(true);
    } else {
      expect(inertHosts).toHaveLength(3);
      expect(inertHosts.every(node => node.props.pointerEvents === 'box-none' && !node.props.accessibilityElementsHidden),
        'iOS keeps the closed host live so its WebView pre-warms at full size (native-sheet.js, ADR 0006)').toBe(true);
    }
    expect(leanSheets().every(sheet => sheet.props.accessibilityElementsHidden === true), 'closed sheets are hidden from VoiceOver / TalkBack').toBe(true);
    deliverNativeLayouts();
    act(() => controls[method]());
    finishAnimations();
    expect(isOpen(sheetOf(kind)), 'Opening must reach the sheet, not just set isOpen').toBe(true);
    expect(sheetReports.at(-1), 'The screen hears that a sheet is open, so the tab bar can step aside').toBe(true);
    act(() => renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityLabel === '完成設定，返回閱讀')[0].props.onPress());
    finishAnimations();
    expect(isOpen(sheetOf(kind))).toBe(false);
    act(() => controls[method]());
    finishAnimations();
    expect(isOpen(sheetOf(kind))).toBe(true);
    // An iPhone has no back button; there the sheet's own done button is the second way out.
    act(() => {
      if (os === 'android') expect(boundary.back?.()).toBe(true);
      else renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityLabel === '完成設定，返回閱讀')[0].props.onPress();
    });
    finishAnimations();
    expect(isOpen(sheetOf(kind))).toBe(false);
    act(() => controls[method]());
    finishAnimations();
    expect(isOpen(sheetOf(kind))).toBe(true);
    const backdrops = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'lean-bottom-sheet-backdrop');
    // Android drops a closed sheet's backdrop; iOS keeps all three mounted, transparent, untouchable and hidden
    // from VoiceOver. Either way exactly one backdrop — the open sheet's — takes a tap.
    const wrapperOf = (node: TestRenderer.ReactTestInstance) => { let at = node.parent; while (at && at.props.pointerEvents === undefined) at = at.parent; return at; };
    const live = backdrops.filter(node => wrapperOf(node)?.props.pointerEvents === 'auto');
    expect(live).toHaveLength(1);
    if (os === 'android') expect(backdrops).toHaveLength(1);
    else expect(backdrops.filter(node => wrapperOf(node)?.props.pointerEvents !== 'auto').every(node => wrapperOf(node)?.props.accessibilityElementsHidden === true)).toBe(true);
    act(() => live[0].props.onPress());
    finishAnimations();
    expect(isOpen(sheetOf(kind))).toBe(false);
    expect(boundary.back, 'A backdrop dismissal must reach the app so its back handler goes away').toBeNull();
    expect(sheetReports.at(-1), 'and hears it closed again').toBe(false);
    expect(animated.state.running).toBe(0);
    expect(boundary.readerMounts).toBe(1);
  });
});
