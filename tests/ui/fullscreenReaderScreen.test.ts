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
  KeyboardAvoidingView: primitive('KeyboardAvoidingView'),
  Keyboard: { isVisible: () => false, addListener: () => ({ remove() {} }) },
  Modal: (p: { visible: boolean; children?: React.ReactNode }) => p.visible ? React.createElement('Modal', p, p.children) : null,
  StyleSheet: { create: (x: unknown) => x, absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
  Linking: { openURL: vi.fn(async () => {}) }, Platform: { OS: 'android' },
  useWindowDimensions: () => ({ width: 393, fontScale: 1 }),
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: (_: string, cb: () => boolean) => { native.back = cb; return { remove: () => { native.back = null; } }; } },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
}));
const safeArea = vi.hoisted(() => ({ value: { top: 24, right: 0, bottom: 16, left: 0 } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView'), useSafeAreaInsets: () => ({ ...safeArea.value }) }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: primitive('Icon') }));
vi.mock('../../src/ui/BibleContentPreloadHost', () => ({ BibleContentPreloadHost: () => null }));
vi.mock('expo-application', () => ({ nativeBuildVersion: '30' }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(), maybeCompleteAuthSession() {} }));
vi.mock('expo-status-bar', () => ({ StatusBar: primitive('StatusBar') }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: Object.assign(primitive('NavigationBar'), { setHidden: vi.fn() }) }));
vi.mock('expo-router', () => ({ router: { replace: vi.fn() }, usePathname: () => '/reader', useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-operation' }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
// Keep the real preload host mounted, but do not import the SDK's MMKV/native registry in Node.
vi.mock('@youversion/platform-react-native-expo-core', () => {
  const fetchBibleContent = vi.fn(async () => ({ content: '' }));
  return { useYouVersion: () => ({ fetchBibleContent }) };
});
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: primitive('AccountEntryButton') }));
vi.mock('../../src/ui/completionFeedback', () => ({ CompletionFeedback: primitive('CompletionFeedback') }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({ CompletionAwardFeedback: () => null }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => ({ status: 'signed-out', session: null }), isCurrentAuthSession: () => false }));
vi.mock('../../src/services/reminderScheduler', () => ({ createReminderScheduler: () => ({}) }));
vi.mock('../../src/services/reminderCompletion', () => ({ syncReadingReminderForCompletion: vi.fn() }));
vi.mock('../../src/services/useOutboxRecovery', () => ({ useOutboxRecovery: () => undefined }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: vi.fn() }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: vi.fn(), openQingmuReaderPositionStore: vi.fn(), openQingmuJournalStore: vi.fn(() => ({ get: () => null, save: (command: Record<string, unknown>) => command })) }));
vi.mock('../../src/ui/routes', () => ({ buildFixtureModels: () => ({ reader: { references: ['PSA.90', 'PSA.91'] } }) }));
vi.mock('../../src/ui/readingSession', () => ({ useReadingSession: () => ({ selectedDate: '2026-09-12', planId: 'church-2026-09', day: {}, period: 'week' }), setSelectedReadingDate: vi.fn(), setPendingJournalQuote: vi.fn() }));
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
let rendered: TestRenderer.ReactTestRenderer;
const all = (type: string) => type === 'ChapterAudioControls' ? rendered.root.findAllByType(ChapterAudioControls) : rendered.root.findAll(n => String(n.type) === type);
const press = (label: string) => act(() => {
  const n = rendered.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  expect(n, 'Missing control: ' + label).toBeDefined(); n.props.onPress();
});
const canvas = (type: string, data: unknown) => act(() => { all('BibleReader')[0].props.dom.onMessage({ nativeEvent: { data: JSON.stringify({ type, data }) } }); });
const toolbar = () => rendered.root.findAll(n => n.props.accessibilityLabel === '閱讀工具列')[0];
const collapsedBar = () => rendered.root.findAll(n => n.props.accessibilityLabel === '展開閱讀工具' && typeof n.props.onPress === 'function')[0];
beforeEach(async () => {
  readerSettings.value = { fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }; readerSettings.listeners.clear();
  native.back = null; native.mounts = 0; native.audioMounts = 0; safeArea.value = { top: 24, right: 0, bottom: 16, left: 0 };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { rendered = TestRenderer.create(React.createElement(ReaderScreen)); });
});
afterEach(() => { act(() => rendered?.unmount()); vi.restoreAllMocks(); });
describe('approved fullscreen Reader assembled entry', () => {
  it('shows scripture with the header tools and ○ ▶, without account or completion cards', () => {
    expect(all('BibleReader')[0].props.showToolbar).toBe(false);
    expect(all('CompletionFeedback')).toHaveLength(0); expect(all('AccountEntryButton')).toHaveLength(0);
    const text = all('Text').map(n => String(n.props.children)).join(' ');
    expect(text).not.toContain('完成所選日期'); expect(text).not.toContain('狀態：'); expect(text).not.toContain('Hong Kong Bible Society');
    expect(toolbar()).toBeDefined();
    expect(all('ChapterAudioControls')[0].props).toMatchObject({ readerAction: true, active: true });
  });
  it('shows the system bars normally, collapses on reading down, and reveals on the reader\'s request or Back without recreating audio', () => {
    expect(all('StatusBar')[0].props.hidden).toBe(false); expect(all('NavigationBar')[0].props.hidden).toBe(false);
    const mounts = native.audioMounts;
    canvas('qingmu.reader.canvas.scroll', { direction: 'down', deltaY: 40 });
    expect(toolbar()).toBeUndefined(); expect(collapsedBar()).toBeDefined();
    expect(all('StatusBar')[0].props.hidden).toBe(true); expect(all('NavigationBar')[0].props.hidden).toBe(true);
    canvas('qingmu.reader.canvas.reveal', { reason: 'top' });
    expect(toolbar()).toBeDefined(); expect(all('StatusBar')[0].props.hidden).toBe(false);
    canvas('qingmu.reader.canvas.scroll', { direction: 'down', deltaY: 40 });
    act(() => { expect(native.back?.()).toBe(true); });
    expect(toolbar()).toBeDefined();
    expect(native.audioMounts).toBe(mounts); expect(native.mounts).toBe(1);
  });
  it('passes the overlay room to the reader canvas', () => {
    const script = all('BibleReader')[0].props.dom.injectedJavaScript as string;
    expect(script).toContain('padding: 132px 16px 209px !important');
  });
  it('never changes the reader page script across collapse and reveal, even while the system bars come back', () => {
    // The DOM WebView reloads the whole page (back to the chapter top) whenever this script changes.
    const script = () => all('BibleReader')[0].props.dom.injectedJavaScript as string;
    const initial = script();
    canvas('qingmu.reader.canvas.scroll', { direction: 'down', deltaY: 40 });
    safeArea.value = { top: 24, right: 0, bottom: 0, left: 0 };
    canvas('qingmu.reader.canvas.edge', { atEnd: false });
    expect(script()).toBe(initial);
    canvas('qingmu.reader.canvas.reveal', { reason: 'up' });
    expect(toolbar()).toBeDefined();
    expect(script()).toBe(initial);
    safeArea.value = { top: 24, right: 0, bottom: 16, left: 0 };
    canvas('qingmu.reader.canvas.edge', { atEnd: true });
    expect(script()).toBe(initial);
    expect(native.mounts).toBe(1);
  });
  it('routes official chapter selection to both scripture and audio through the same owner', async () => {
    press('更多閱讀工具'); press('選擇其他章節');
    await act(async () => { await all('OfficialChapterSheet')[0].props.onSelect({ book: 'GEN', chapter: '1', versionId: 46 }); });
    expect(all('BibleReader')[0].props.book).toBe('GEN'); expect(all('BibleReader')[0].props.chapter).toBe('1');
    expect(all('ChapterAudioControls')[0].props.chapterUsfm).toBe('GEN.1'); expect(native.mounts).toBe(1);
  });
  it.each(['done', 'android-back', 'outside-or-pan'])('returns from settings via %s without recreating scripture', path => {
    press('更多閱讀工具'); press('調整字體'); expect(all('OfficialSettingsSheet')[0].props.isSettingsSheetOpen).toBe(true);
    if (path === 'done') press('完成設定，返回閱讀'); else if (path === 'android-back') act(() => { expect(native.back?.()).toBe(true); }); else act(() => all('OfficialSettingsSheet')[0].props.onClose());
    expect(all('OfficialSettingsSheet')).toHaveLength(1); expect(all('OfficialSettingsSheet')[0].props.isSettingsSheetOpen).toBe(false); expect(all('BibleReader')[0].props.chapter).toBe('90'); expect(native.mounts).toBe(1);
  });
});
