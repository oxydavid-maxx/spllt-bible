import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.EXPO_PUBLIC_YOUVERSION_APP_KEY = 'test-app-key'; process.env.EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE = 'true'; process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false'; process.env.EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED = 'false'; });
const native = vi.hoisted(() => ({ back: null as null | (() => boolean), mounts: 0, audioMounts: 0 }));
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const R = require('react') as typeof React;
  return R.createElement(name, props, props.children as React.ReactNode);
});
const readerSettings = vi.hoisted(() => ({ value: { fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }, listeners: new Set<(next: { fontSize: number; fontFamily: string; lineSpacing: number }) => void>() }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => {
  const R = require('react') as typeof React;
  const ref = R.useRef<object | null>(null);
  if (!ref.current) { native.audioMounts++; ref.current = { play() {}, pause() {}, replace() {}, async seekTo() {}, setPlaybackRate() {}, remove() {}, addListener: () => ({ remove() {} }), currentTime: 0, duration: 0, playing: false, isLoaded: false, isBuffering: false }; }
  return ref.current;
} }));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'),
  Modal: (p: { visible: boolean; children?: React.ReactNode }) => p.visible ? React.createElement('Modal', p, p.children) : null,
  StyleSheet: { create: (x: unknown) => x, absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
  Linking: { openURL: vi.fn(async () => {}) }, Platform: { OS: 'android' },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: (_: string, cb: () => boolean) => { native.back = cb; return { remove: () => { native.back = null; } }; } },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView'), useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('expo-status-bar', () => ({ StatusBar: primitive('StatusBar') }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: Object.assign(primitive('NavigationBar'), { setHidden: vi.fn() }) }));
vi.mock('expo-router', () => ({ router: { replace: vi.fn() }, useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-operation' }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: primitive('AccountEntryButton') }));
vi.mock('../../src/ui/ReadingDateNavigator', () => ({ ReadingDateNavigator: primitive('ReadingDateNavigator') }));
vi.mock('../../src/ui/completionFeedback', () => ({ CompletionFeedback: primitive('CompletionFeedback') }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => ({ session: null }) }));
vi.mock('../../src/services/reminderScheduler', () => ({ createReminderScheduler: () => ({}) }));
vi.mock('../../src/services/reminderCompletion', () => ({ syncReadingReminderForCompletion: vi.fn() }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: vi.fn() }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: vi.fn(), openQingmuReaderPositionStore: vi.fn(), openQingmuJournalStore: vi.fn(() => ({ get: () => null, save: (command: Record<string, unknown>) => command })) }));
vi.mock('../../src/ui/routes', () => ({ buildFixtureModels: () => ({ reader: { references: ['PSA.90', 'PSA.91'] } }) }));
vi.mock('../../src/ui/readingSession', () => ({ useReadingSession: () => ({ selectedDate: '2026-09-12', day: {}, period: 'week' }), setSelectedReadingDate: vi.fn() }));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => ({ status: 'READER_UI_READY', module: {
  getReaderSettings: () => ({ ...readerSettings.value }),
  getDefaultReaderSettings: () => ({ fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }),
  setReaderSettings: (next: Partial<typeof readerSettings.value>) => { readerSettings.value = { ...readerSettings.value, ...next }; readerSettings.listeners.forEach(listener => listener({ ...readerSettings.value })); },
  subscribeReaderSettings: (listener: (next: typeof readerSettings.value) => void) => { readerSettings.listeners.add(listener); return () => { readerSettings.listeners.delete(listener); }; },
  YouVersionProvider: primitive('YVProvider'), BibleReaderSettingsSheet: primitive('OfficialSettingsSheet'), BibleChapterPickerSheet: primitive('OfficialChapterSheet'), BibleVersionPickerSheet: primitive('OfficialVersionSheet'),
  BibleReader: (props: Record<string, unknown>) => { React.useEffect(() => { native.mounts++; }, []); return React.createElement('BibleReader', props); },
} }) }) }));
import ReaderScreen from '../../app/(tabs)/reader';
import { ChapterAudioControls } from '../../src/ui/ChapterAudioControls';
import { getYouVersionVersionOptions } from '../../src/config/youVersionContent';
let rendered: TestRenderer.ReactTestRenderer;
const all = (type: string) => type === 'ChapterAudioControls' ? rendered.root.findAllByType(ChapterAudioControls) : rendered.root.findAll(n => String(n.type) === type);
const press = (label: string) => act(() => {
  const n = rendered.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  expect(n, 'Missing control: ' + label).toBeDefined(); n.props.onPress();
});
const canvas = (type = 'qingmu.reader.canvas.tap') => act(() => { all('BibleReader')[0].props.dom.onMessage({ nativeEvent: { data: JSON.stringify({ type, data: null }) } }); });
const toolbar = () => rendered.root.findAll(n => n.props.accessibilityLabel === '閱讀工具列')[0];
beforeEach(async () => {
  readerSettings.value = { fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }; readerSettings.listeners.clear();
  native.back = null; native.mounts = 0; native.audioMounts = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { rendered = TestRenderer.create(React.createElement(ReaderScreen)); });
});
afterEach(() => { act(() => rendered?.unmount()); vi.restoreAllMocks(); });
describe('approved fullscreen Reader assembled entry', () => {
  it('shows scripture with persistent compact tools and no date, account or completion cards', () => {
    expect(all('BibleReader')[0].props.showToolbar).toBe(false);
    expect(all('ReadingDateNavigator')).toHaveLength(0); expect(all('CompletionFeedback')).toHaveLength(0); expect(all('AccountEntryButton')).toHaveLength(0);
    const text = all('Text').map(n => String(n.props.children)).join(' ');
    expect(text).not.toContain('完成所選日期'); expect(text).not.toContain('狀態：'); expect(text).not.toContain('Hong Kong Bible Society');
    expect(all('ChapterAudioControls')[0].props.compact).toBe(true); expect(all('ChapterAudioControls')[0].props.active).toBe(true);
  });
  it('keeps common tools reachable while system bars stay hidden, without recreating audio on canvas gestures', () => {
    expect(all('StatusBar')[0]?.props.hidden).toBe(true); expect(all('NavigationBar')[0]?.props.hidden).toBe(true);
    expect(toolbar()?.props.pointerEvents).toBe('box-none'); const mounts = native.audioMounts;
    canvas(); expect(toolbar().props.pointerEvents).toBe('box-none'); expect(all('StatusBar')[0].props.hidden).toBe(true);
    canvas('qingmu.reader.canvas.scroll'); expect(toolbar().props.pointerEvents).toBe('box-none'); expect(native.audioMounts).toBe(mounts);
  });
  it('routes official chapter selection to both scripture and audio through the same owner', async () => {
    press('更多閱讀工具'); press('選擇其他章節');
    await act(async () => { await all('OfficialChapterSheet')[0].props.onSelect({ book: 'GEN', chapter: '1', versionId: 46 }); });
    expect(all('BibleReader')[0].props.book).toBe('GEN'); expect(all('BibleReader')[0].props.chapter).toBe('1');
    expect(all('ChapterAudioControls')[0].props.chapterUsfm).toBe('GEN.1'); expect(native.mounts).toBe(1);
  });
  it.each(['done', 'android-back', 'outside-or-pan'])('returns from settings via %s without recreating scripture', path => {
    canvas(); press('更多閱讀工具'); press('調整字體'); expect(all('OfficialSettingsSheet')[0].props.isSettingsSheetOpen).toBe(true);
    if (path === 'done') press('完成設定，返回閱讀'); else if (path === 'android-back') act(() => { expect(native.back?.()).toBe(true); }); else act(() => all('OfficialSettingsSheet')[0].props.onClose());
    expect(all('OfficialSettingsSheet')).toHaveLength(1); expect(all('OfficialSettingsSheet')[0].props.isSettingsSheetOpen).toBe(false); expect(all('BibleReader')[0].props.chapter).toBe('90'); expect(native.mounts).toBe(1);
  });
});
