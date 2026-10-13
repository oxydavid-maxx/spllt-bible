// Half-chapter days on the assembled reader screen (maintainer 2026-10-01/02): the day's range reaches the
// official reader's page (which opens at it and greys the rest, tests/ui/readingRangeBridge.test.ts) and
// the narration; the page's report of the range's last verse reaches the chrome; two halves of one
// chapter on one day are one tag. The mock setup is the one tests/ui/readAlongScreen.test.ts uses.
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
const plan = vi.hoisted(() => ({ references: ['PSA.119.1-88'] }));
vi.mock('../../src/ui/readingSession', () => ({ useReadingSession: () => ({ selectedDate: '2026-10-15', planId: 'church-2026-09', day: { date: '2026-10-15', references: plan.references }, period: 'week' }), setSelectedReadingDate: vi.fn(), setPendingJournalQuote: vi.fn() }));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => ({ status: 'READER_UI_READY', module: {
  getReaderSettings: () => ({ ...readerSettings.value }),
  getDefaultReaderSettings: () => ({ fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }),
  setReaderSettings: (next: Partial<typeof readerSettings.value>) => { readerSettings.value = { ...readerSettings.value, ...next }; readerSettings.listeners.forEach(listener => listener({ ...readerSettings.value })); },
  subscribeReaderSettings: (listener: (next: typeof readerSettings.value) => void) => { readerSettings.listeners.add(listener); return () => { readerSettings.listeners.delete(listener); }; },
  YouVersionProvider: primitive('YVProvider'), BibleReaderSettingsSheet: primitive('OfficialSettingsSheet'), BibleChapterPickerSheet: primitive('OfficialChapterSheet'), BibleVersionPickerSheet: primitive('OfficialVersionSheet'),
  BibleReader: (props: Record<string, unknown>) => { React.useEffect(() => { native.mounts++; }, []); return React.createElement('BibleReader', props); },
} }) }) }));
// ▶ is a probe here: it keeps the real autoplay context the reader provides, so a test can narrate a verse
// the way the audio controls do (onPlayingVerse), without playing audio.
const probe = vi.hoisted(() => ({ autoplay: null as null | { onPlayingVerse?: (chapter: string, verse: number | null) => void } }));
vi.mock('../../src/ui/ChapterAudioControls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/ChapterAudioControls')>();
  const R = await import('react');
  return { ...actual, ChapterAudioControls: R.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    probe.autoplay = actual.useChapterAudioAutoplay();
    R.useImperativeHandle(ref, () => ({ pause: async () => undefined }));
    return R.createElement('ChapterAudioControls', props);
  }) };
});
import ReaderScreen from '../../app/(tabs)/reader';
let rendered: TestRenderer.ReactTestRenderer;
const all = (type: string) => rendered.root.findAll(n => String(n.type) === type);
const reader = () => all('BibleReader')[0];
const page = (type: string, data: unknown) => act(() => { reader().props.dom.onMessage({ nativeEvent: { data: JSON.stringify({ type, data }) } }); });
const chips = () => rendered.root.findAll(n => String(n.type) === 'Pressable' && n.props.accessibilityState && 'selected' in n.props.accessibilityState && typeof n.props.onPress === 'function'
  && n.props.accessibilityLabel?.includes('今日第')).map(n => n.findAll(t => String(t.type) === 'Text').map(t => t.props.children).join(''));
const text = () => JSON.stringify(rendered.toJSON());
async function mount(references: string[]) {
  plan.references = references;
  await act(async () => { rendered = TestRenderer.create(React.createElement(ReaderScreen)); });
}
beforeEach(() => {
  readerSettings.value = { fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }; readerSettings.listeners.clear();
  native.back = null; native.mounts = 0; native.audioMounts = 0; safeArea.value = { top: 24, right: 0, bottom: 16, left: 0 };
  probe.autoplay = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { act(() => rendered?.unmount()); vi.restoreAllMocks(); });

describe('a half-chapter day on the assembled reader screen', () => {
  it('shows the whole chapter, hands the day\'s range to the page and to the narration, and tags it with the range', async () => {
    await mount(['PSA.119.1-88']);
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '119', readingRange: 'PSA.119.1-88' });
    expect(all('ChapterAudioControls')[0].props).toMatchObject({ chapterUsfm: 'PSA.119', verseRange: { first: 1, last: 88 } });
    expect(chips()).toEqual(['詩119:1-88']);
  });

  it('tells the chrome when the page reaches the range\'s last verse, and offers the next passage there', async () => {
    await mount(['ACT.7.1-29', 'PSA.126']);
    expect(reader().props.readingRange).toBe('ACT.7.1-29');
    expect(text()).not.toContain('繼續讀');
    page('qingmu.reader.range.end', { range: 'ACT.7.1-29', atEnd: true });
    expect(text()).toContain('繼續讀 詩126 ›');
    page('qingmu.reader.range.end', { range: 'ACT.7.1-29', atEnd: false });
    expect(text()).not.toContain('繼續讀');
  });

  it('reads two halves of one chapter on one day as the chapter, once', async () => {
    await mount(['ACT.2.1-24', 'ACT.2.25-47']);
    expect(chips()).toEqual(['徒2']);
    expect(reader().props).toMatchObject({ book: 'ACT', chapter: '2', readingRange: null });
    expect(all('ChapterAudioControls')[0].props.verseRange).toBeNull();
  });

  it('has no range on a whole-chapter day', async () => {
    await mount(['ACT.1', 'ACT.2.1-24']);
    expect(chips()).toEqual(['徒1', '徒2:1-24']);
    expect(reader().props.readingRange).toBeNull();
  });
});
