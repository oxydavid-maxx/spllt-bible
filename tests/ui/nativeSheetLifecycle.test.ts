import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { create } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface NativeRecord {
  kind: string;
  detents: number[] | undefined;
  layoutReady: boolean;
  attempts: number;
  animations: number;
  position: number;
  onChange?: (index: number) => void;
  snapToIndex(index: number): void;
  close(): void;
}
const boundary = vi.hoisted(() => ({ module: null as any, records: new Set<NativeRecord>(), readerMounts: 0, back: null as null | (() => boolean) }));
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const R = require('react') as typeof React;
  return R.createElement(name, props, props.children as React.ReactNode);
});
const rn = vi.hoisted(() => ({
  ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'),
  Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'),
  Platform: { OS: 'android' }, useWindowDimensions: () => ({ width: 390, height: 844 }),
  StyleSheet: { create: (x: unknown) => x, flatten: (x: unknown) => Object.assign({}, ...[x].flat(Infinity)), absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
  BackHandler: { addEventListener: (_: string, cb: () => boolean) => { boundary.back = cb; return { remove: () => { boundary.back = null; } }; } },
}));
vi.mock('react-native', () => rn);
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView'), useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) }));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => ({ status: 'READER_UI_READY', module: boundary.module }) }) }));
import { YouVersionReader, type ReaderOverlayControls } from '../../src/ui/YouVersionReader';

// Execute the installed Gorhom public snap method, not a copied readiness model.
// Native layout delivery and UI-thread animation are the only controlled boundary.
const gorhomPath = 'node_modules/@gorhom/bottom-sheet/src/components/bottomSheet/BottomSheet.tsx';
const gorhomSource = ts.createSourceFile(gorhomPath, readFileSync(gorhomPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let snapFunctionSource = '';
function visit(node: ts.Node) {
  if (ts.isFunctionExpression(node) && node.name?.text === 'handleSnapToIndex') snapFunctionSource = node.getText(gorhomSource);
  ts.forEachChild(node, visit);
}
visit(gorhomSource);
if (!snapFunctionSource) throw new Error('Installed Gorhom public snap method not found');
const snapJs = ts.transpileModule(`const boundSnap = (${snapFunctionSource});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const snapFactory = new Function('animatedDetentsState', 'isLayoutCalculated', 'invariant', 'animatedAnimationState', 'isInTemporaryPosition', 'runOnUI', 'animateToPosition', 'ANIMATION_SOURCE', '__DEV__', 'print', `${snapJs}\nreturn boundSnap;`);
function makeRecord(kind: string): NativeRecord {
  const record: NativeRecord = { kind, detents: undefined, layoutReady: false, attempts: 0, animations: 0, position: -1, snapToIndex() {}, close() { record.position = -1; record.onChange?.(-1); } };
  const snap = snapFactory(
    { get: () => ({ detents: record.detents }) },
    { get: () => record.layoutReady, get value() { return record.layoutReady; } },
    (condition: boolean, message: string) => { if (!condition) throw new Error(message); },
    { get: () => ({ nextPosition: null, nextIndex: null, isForcedClosing: false }) },
    { value: false }, (fn: Function) => fn,
    (position: number) => { record.animations++; record.position = position; record.onChange?.(0); },
    { USER: 'USER' }, false, () => {},
  );
  record.snapToIndex = index => { record.attempts++; snap(index); };
  return record;
}
function kindIn(children: any): string | null {
  if (Array.isArray(children)) return children.map(kindIn).find(Boolean) ?? null;
  if (!children || typeof children !== 'object') return null;
  if (['SettingsDom', 'ChapterDom', 'VersionDom'].includes(children.type)) return children.type;
  return kindIn(children.props?.children);
}
function NativeBottomSheet(props: any) {
  const [record] = React.useState(() => makeRecord(kindIn(props.children) ?? 'direct'));
  record.onChange = props.onChange;
  React.useImperativeHandle(props.ref, () => ({ snapToIndex: record.snapToIndex, close: record.close }), [record]);
  React.useEffect(() => { boundary.records.add(record); return () => { boundary.records.delete(record); }; }, [record]);
  return React.createElement('NativeBottomSheet', {}, props.children);
}
function loadInstalledSheets() {
  const registry = new Map<string, any>([['BibleReaderSettings', 'SettingsDom'], ['ChapterPickerContent', 'ChapterDom'], ['BibleVersionPickerContent', 'VersionDom']]);
  const settings = { fontSize: 20, fontFamily: 'serif', lineSpacing: 'normal', setFontFamily() {}, setFontSize() {}, setLineSpacing() {} };
  const settingsStore = Object.assign(() => settings, { getState: () => settings });
  const dependencies: Record<string, any> = {
    'react': React, 'react/jsx-runtime': jsxRuntime, 'react-native': rn, 'zustand': { create },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 24 }) },
    '@gorhom/bottom-sheet': { __esModule: true, default: NativeBottomSheet, BottomSheetView: primitive('BottomSheetView'), BottomSheetBackdrop: primitive('BottomSheetBackdrop') },
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
let controls: ReaderOverlayControls;
let installed: ReturnType<typeof loadInstalledSheets>;
const deliverNativeLayouts = () => { for (const record of boundary.records) { record.detents = [400]; record.layoutReady = true; } };
async function mountReader() {
  await act(async () => { renderer = TestRenderer.create(React.createElement(YouVersionReader, {
    date: '2026-09-12', references: ['PSA.90'], appKey: 'test-key', versionId: 1392, book: 'PSA', chapter: '90',
    allowedVersionIds: [1392, 312], allowTechnicalProbe: true, fullscreen: true,
    renderScreen: (reader, next) => { controls = next; return reader; },
  })); });
}
beforeEach(() => {
  boundary.records.clear(); boundary.readerMounts = 0; boundary.back = null;
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

describe('installed native-sheet readiness boundary', () => {
  it('falsifies cold mount-open: late native layout does not replay the lost SDK opening command', async () => {
    await act(async () => { renderer = TestRenderer.create(React.createElement(installed.BibleReaderSettingsSheet, { isSettingsSheetOpen: true, onClose() {} })); });
    const record = [...boundary.records][0];
    expect(record.attempts).toBe(1);
    expect(record.animations).toBe(0);
    deliverNativeLayouts();
    await act(async () => {});
    expect(record.animations).toBe(0);
    expect(record.position).toBe(-1);
  });
  it('uses the installed Gorhom empty-detent and layout-ready guards', () => {
    const record = makeRecord('guard');
    record.snapToIndex(0); expect(record.animations).toBe(0);
    record.detents = []; record.snapToIndex(0); expect(record.animations).toBe(0);
    record.detents = [400]; record.snapToIndex(0); expect(record.animations).toBe(0);
    record.layoutReady = true; record.snapToIndex(0); expect(record.animations).toBe(1);
  });
  it.each([
    ['openSettings', 'SettingsDom'], ['openChapterPicker', 'ChapterDom'], ['openVersionPicker', 'VersionDom'],
  ] as const)('opens %s after its native layout and keeps that host through dismiss/reopen', async (method, kind) => {
    await mountReader();
    const inertHosts = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'native-sheet-inert-host');
    expect(inertHosts).toHaveLength(3);
    expect(inertHosts.every(node => node.props.pointerEvents === 'none' && node.props.importantForAccessibility === 'no-hide-descendants')).toBe(true);
    deliverNativeLayouts();
    act(() => controls[method]());
    const record = [...boundary.records].find(value => value.kind === kind)!;
    expect(record, 'Official sheet must have a native host').toBeDefined();
    expect(record.animations, 'Opening must reach the real Gorhom animation boundary, not just set isOpen').toBe(1);
    expect(record.position).toBe(400);
    act(() => renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityLabel === '完成設定，返回閱讀')[0].props.onPress());
    expect(boundary.records.has(record)).toBe(true);
    expect(record.position).toBe(-1);
    act(() => controls[method]());
    expect(record.animations).toBe(2);
    act(() => { expect(boundary.back?.()).toBe(true); });
    expect(boundary.records.has(record)).toBe(true);
    expect(record.position).toBe(-1);
    act(() => controls[method]());
    expect(record.animations).toBe(3);
    act(() => record.onChange?.(-1));
    expect(boundary.back).toBeNull();
    expect(boundary.readerMounts).toBe(1);
  });
});
