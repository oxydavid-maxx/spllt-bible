import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReaderSettingsSdk } from '../helpers/loadReaderSettingsSdk';
import type { ReaderPosition } from '../../src/storage/readerPosition';

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_QINGMU_TEST_DATE = '2026-09-13';
  process.env.EXPO_PUBLIC_YOUVERSION_APP_KEY = 'test-app-key';
  process.env.EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE = 'true';
  process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false';
  process.env.EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED = 'true';
  process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL = 'https://test.invalid';
});
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const R = require('react') as typeof React;
  return R.createElement(name, props, props.children as React.ReactNode);
});
const boundary = vi.hoisted(() => ({ sdk: null as any, sdkLoads: 0, positions: new Map<string, ReaderPosition>(), preferences: new Map<string, string>(), requests: [] as { versionId: number; usfm: string }[], completions: vi.fn(), flush: vi.fn(async () => []), completionRecord: null as any, alert: vi.fn(), openURL: vi.fn(async () => undefined), focusEffects: new Map<() => void, (() => void) | void>(), session: { memberId: 'A', sessionToken: 'test-session' } }));
vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'), TextInput: primitive('TextInput'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'),
  Modal: (props: { visible: boolean; children?: React.ReactNode }) => props.visible ? React.createElement('Modal', props, props.children) : null,
  StyleSheet: { create: (x: unknown) => x, absoluteFill: {} }, Alert: { alert: boundary.alert }, Linking: { openURL: boundary.openURL },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  KeyboardAvoidingView: primitive('KeyboardAvoidingView'), Platform: { OS: 'android' },
  useWindowDimensions: () => ({ width: 393, fontScale: 1 }),
  Keyboard: { isVisible: () => false, addListener: () => ({ remove() {} }) },
  AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isScreenReaderEnabled: async () => false },
}));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: primitive('Icon') }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView'), useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) }));
vi.mock('expo-application', () => ({ nativeBuildVersion: '30' }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(), maybeCompleteAuthSession() {} }));
vi.mock('expo-router', () => ({ router: { replace: vi.fn() }, usePathname: () => '/reader', useFocusEffect: (callback: () => any) => React.useEffect(() => {
  const cleanup = callback();
  boundary.focusEffects.set(callback, cleanup);
  return () => { if (typeof cleanup === 'function') cleanup(); boundary.focusEffects.delete(callback); };
}, [callback]) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-operation' }));
vi.mock('expo-status-bar', () => ({ StatusBar: primitive('StatusBar') }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: Object.assign(primitive('NavigationBar'), { setHidden: vi.fn() }) }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => React.useMemo(() => ({ pause() {}, play() {}, replace() {}, seekTo: async () => {}, setPlaybackRate() {}, remove() {}, addListener: () => ({ remove() {} }), currentTime: 0, duration: 0, playing: false, isLoaded: false, isBuffering: false }), []) }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => boundary.preferences.get(key) ?? null, setItemAsync: async (key: string, value: string) => { boundary.preferences.set(key, value); } }));
vi.mock('../../src/services/authSession', () => ({
  useAuthSnapshot: () => ({ status: 'signed-in', session: boundary.session, epoch: 1, expiresAt: null }),
  getAuthSnapshot: () => ({ status: 'signed-in', session: boundary.session, epoch: 1, expiresAt: null }),
  isCurrentAuthSession: (session: { memberId?: string; sessionToken?: string } | null) => session?.memberId === boundary.session.memberId && session?.sessionToken === boundary.session.sessionToken,
}));
vi.mock('../../src/services/reminderScheduler', () => ({ createReminderScheduler: () => ({}) }));
vi.mock('../../src/services/reminderCompletion', () => ({ syncReadingReminderForCompletion: vi.fn() }));
vi.mock('../../src/services/useOutboxRecovery', () => ({ useOutboxRecovery: () => undefined }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({ CompletionAwardFeedback: () => null }));
vi.mock('../../src/ui/BibleContentPreloadHost', () => ({ BibleContentPreloadHost: () => null }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ saveCompletion: boundary.completions, getProgress: async () => undefined }) }));
vi.mock('../../src/storage/mobileDatabase', () => ({
  openQingmuRepository: () => ({ get: (identity: { memberId: string; planId: string; taskDate: string }) => {
    const record = boundary.completionRecord;
    return record && record.memberId === identity.memberId && record.planId === identity.planId && record.taskDate === identity.taskDate ? record : undefined;
  }, hasPendingCompletion: () => boundary.completionRecord?.syncStatus === 'SAVE_FAILED', flush: boundary.flush, saveCompletion: boundary.completions }),
  openQingmuJournalStore: () => ({ get: () => null, save: (command: Record<string, unknown>) => command }),
  openQingmuReaderPositionStore: () => ({
    get: (memberId: string, _plan: string, date: string) => boundary.positions.get(`${memberId}:${date}`),
    save: (position: ReaderPosition) => { boundary.positions.set(`${position.memberId}:${position.taskDate}`, position); }, resetToAssigned: vi.fn(),
  }),
}));
vi.mock('../../src/services/youVersionAdapter', () => ({ createYouVersionAdapter: () => ({ loadReaderUi: async () => { boundary.sdkLoads++; return { status: 'READER_UI_READY', module: boundary.sdk }; } }) }));
vi.mock('../../src/services/contentCapabilityClient', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/services/contentCapabilityClient')>(),
  createCapabilityCoordinator: () => ({ cancel() {}, request: async (identity: { versionId: number; usfm: string }) => {
    boundary.requests.push({ ...identity });
    return { kind: 'unavailable', identity, status: 'no_matching_chapter', message: '本章沒有可用語音。', retryable: false };
  } }),
}));

// Calendar, date session, route model, caller, wrapper, preferences binding,
// fullscreen layout and audio controls are real. No dates/references are mocked.
import ReaderScreen from '../../app/(tabs)/reader';
import { FullscreenReaderLayout } from '../../src/ui/FullscreenReaderLayout';
import { ChapterAudioControls } from '../../src/ui/ChapterAudioControls';
import { canonicalSeptemberPlan, getInitialReadingDate, getReadingDay } from '../../src/domain/calendar';
import { buildFixtureModels } from '../../src/ui/routes';
import { setSelectedReadingDate } from '../../src/ui/readingSession';

let rendered: TestRenderer.ReactTestRenderer;
const all = (type: string) => rendered.root.findAll(node => String(node.type) === type);
const audio = () => rendered.root.findByType(ChapterAudioControls);
const reader = () => all('OfficialReader')[0];
const layout = () => rendered.root.findByType(FullscreenReaderLayout);
const button = (label: string) => { const value = all('Pressable').find(node => node.props.accessibilityLabel === label); expect(value, label).toBeDefined(); return value!; };
async function mount() { await act(async () => { rendered = TestRenderer.create(React.createElement(ReaderScreen)); }); }
async function simulateReaderRefocus() { await act(async () => {
  for (const [callback, cleanup] of [...boundary.focusEffects.entries()]) {
    if (typeof cleanup === 'function') cleanup();
    const nextCleanup = callback();
    boundary.focusEffects.set(callback, typeof nextCleanup === 'function' ? nextCleanup : undefined);
  }
}); }
beforeEach(() => {
  boundary.positions.clear(); boundary.preferences.clear(); boundary.requests = []; boundary.sdkLoads = 0; boundary.completions.mockReset(); boundary.flush.mockReset().mockResolvedValue([]); boundary.completionRecord = null; boundary.alert.mockClear(); boundary.openURL.mockClear(); boundary.focusEffects.clear();
  boundary.completions.mockImplementation((command: { memberId: string; planId: string; taskDate: string; desiredStatus: 'COMPLETED' | 'NOT_COMPLETED'; expectedRevision: number }) => {
    boundary.completionRecord = { memberId: command.memberId, planId: command.planId, taskDate: command.taskDate, status: command.desiredStatus, revision: command.expectedRevision + 1, syncStatus: 'PENDING_SAVE' };
    return boundary.completionRecord;
  });
  setSelectedReadingDate('2026-09-13');
  boundary.sdk = { ...loadReaderSettingsSdk().api, YouVersionProvider: primitive('OfficialProvider'), BibleReader: primitive('OfficialReader'), BibleReaderSettingsSheet: primitive('SettingsSheet'), BibleChapterPickerSheet: primitive('ChapterSheet'), BibleVersionPickerSheet: primitive('VersionSheet') };
  vi.spyOn(console, 'error').mockImplementation((...args) => { const message = String(args[0] ?? ''); if (!message.includes('react-test-renderer is deprecated') && !message.includes('testing environment is not configured to support act')) throw new Error(message); });
});
afterEach(() => { if (rendered) act(() => rendered.unmount()); vi.restoreAllMocks(); });

describe('real unscheduled-day route initializes a free Bible reader', () => {
  it('opens JHN.1 and resolves the same audio identity on actual Sunday without inventing a task', async () => {
    expect(getInitialReadingDate(canonicalSeptemberPlan, '2026-09-13')).toBe('2026-09-13');
    expect(getReadingDay(canonicalSeptemberPlan, '2026-09-13')).toBeUndefined();
    expect(buildFixtureModels('2026-09-13').reader.references).toEqual([]);
    await mount();
    expect(all('OfficialReader')).toHaveLength(1);
    expect(boundary.sdkLoads).toBe(1);
    expect(reader().props).toMatchObject({ book: 'JHN', chapter: '1' });
    expect(audio().props.chapterUsfm).toBe('JHN.1');
    expect(boundary.requests).toContainEqual({ versionId: reader().props.versionId, usfm: 'JHN.1' });
    expect(layout().props.references).toEqual([]); expect(layout().props.controls.ready).toBe(true);
    expect(boundary.completions).not.toHaveBeenCalled();
    expect(layout().props.completionDisabled).toBe(true);
    expect(all('Text').map(node => String(node.props.children)).join(' ')).toContain('這一天沒有排定讀經');
    const text = all('Text').map(node => String(node.props.children)).join(' ');
    expect(text).not.toContain('官方閱讀器還在準備中');
    expect(text).not.toContain('正在取得本章語音');
  });
  it('uses the valid saved free-browse position on Sunday instead of the fallback', async () => {
    boundary.positions.set('A:2026-09-13', { memberId: 'A', planId: 'church-2026-09', taskDate: '2026-09-13', versionId: 40, book: 'PSA', chapter: '90', reference: 'PSA.90', mode: 'FREE_BROWSE', updatedAt: 'test' });
    await mount();
    expect(all('OfficialReader')).toHaveLength(1);
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '90' });
    expect(audio().props.chapterUsfm).toBe('PSA.90');
    expect(boundary.requests.length).toBeGreaterThan(0);
    expect(boundary.requests.every(request => request.usfm === 'PSA.90')).toBe(true);
    expect(layout().props.references).toEqual([]);
  });
  it('keeps official chapter/version changes aligned and restores the scheduled 9/12 passages', async () => {
    await mount();
    expect(all('OfficialReader')).toHaveLength(1);
    act(() => layout().props.controls.openChapterPicker());
    await act(async () => all('ChapterSheet')[0].props.onSelect({ book: 'GEN', chapter: '2', versionId: 40 }));
    expect(reader().props).toMatchObject({ book: 'GEN', chapter: '2', versionId: 40 });
    expect(audio().props).toMatchObject({ chapterUsfm: 'GEN.2', versionId: 40 });
    await act(async () => setSelectedReadingDate('2026-09-12'));
    expect(layout().props.references).toEqual(['1TI.1', 'PSA.90', 'PSA.91']);
    expect(reader().props).toMatchObject({ book: '1TI', chapter: '1', versionId: 40 });
    expect(audio().props.chapterUsfm).toBe('1TI.1');
    act(() => layout().props.onSelectReference(2));
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '91' });
    expect(audio().props.chapterUsfm).toBe('PSA.91');
    expect(boundary.completions).not.toHaveBeenCalled();
  });
  it('opens the selected free-browse chapter and version in YouVersion and keeps Reader selection on return', async () => {
    await mount();
    act(() => layout().props.controls.openChapterPicker());
    await act(async () => all('ChapterSheet')[0].props.onSelect({ book: 'PSA', chapter: '98', versionId: 46 }));
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '98', versionId: 46 });
    expect(audio().props).toMatchObject({ chapterUsfm: 'PSA.98', versionId: 46 });
    act(() => layout().props.chrome.openMore());
    await act(async () => { button('在 YouVersion 開啟此章').props.onPress(); await Promise.resolve(); });
    expect(boundary.openURL).toHaveBeenCalledExactlyOnceWith('https://www.bible.com/bible/46/PSA.98');
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '98', versionId: 46 });
    await simulateReaderRefocus();
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '98', versionId: 46 });
    expect(layout().props.selectedDate).toBe('2026-09-13');
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '98', versionId: 46 });
    expect(layout().props.selectedDate).toBe('2026-09-13');
    expect(boundary.completions).not.toHaveBeenCalled();
  });
  it('restores the selected assigned chapter for the same reading date after Reader remounts', async () => {
    setSelectedReadingDate('2026-09-12');
    await mount();
    act(() => layout().props.onSelectReference(2));
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '91' });
    expect(boundary.positions.get('A:2026-09-12')).toMatchObject({ mode: 'ASSIGNED', reference: 'PSA.91' });
    act(() => rendered.unmount());
    rendered = null as unknown as TestRenderer.ReactTestRenderer;
    await mount();
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '91' });
    expect(audio().props.chapterUsfm).toBe('PSA.91');
  });
  it('writes one completion with one operationId when the right action is tapped twice quickly', async () => {
    setSelectedReadingDate('2026-09-22');
    await mount();
    const complete = button('完成讀經');
    await act(async () => { const first = complete.props.onPress(); complete.props.onPress(); await first; });
    expect(boundary.completions).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      memberId: 'A', planId: 'church-2026-09', taskDate: '2026-09-22', desiredStatus: 'COMPLETED',
      operationId: 'test-operation', expectedRevision: 0,
    }));
    expect(layout().props.completionPending).toBe(true);
    expect(button('同步中').props.disabled).toBe(true);
  });
  it('keeps the original undo confirmation before queuing the reverse operation', async () => {
    setSelectedReadingDate('2026-09-22');
    boundary.completionRecord = { memberId: 'A', planId: 'church-2026-09', taskDate: '2026-09-22', status: 'COMPLETED', revision: 1, syncStatus: 'CONFIRMED' };
    await mount();
    act(() => { button('已完成，可撤銷完成確認').props.onPress(); });
    expect(boundary.completions).not.toHaveBeenCalled();
    expect(boundary.alert).toHaveBeenCalledWith('撤銷完成', '確定撤銷 2026-09-22 的完成？這一天的積分會一併撤回。', expect.any(Array));
    const confirmation = boundary.alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => { confirmation.find(item => item.text === '撤銷')?.onPress?.(); await Promise.resolve(); });
    expect(boundary.completions).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      desiredStatus: 'NOT_COMPLETED', operationId: 'test-operation', expectedRevision: 1,
    }));
  });
  it('keeps a failed completion visible and retries the queued operation without minting a second id', async () => {
    setSelectedReadingDate('2026-09-22');
    boundary.completionRecord = { memberId: 'A', planId: 'church-2026-09', taskDate: '2026-09-22', status: 'COMPLETED', revision: 1, syncStatus: 'SAVE_FAILED' };
    await mount();
    expect(button('同步失敗，重試同步').props.disabled).toBe(false);
    const flushCountBeforeRetry = boundary.flush.mock.calls.length;
    boundary.flush.mockImplementation(async () => {
      boundary.completionRecord = { ...boundary.completionRecord, syncStatus: 'CONFIRMED' };
      return [];
    });
    await act(async () => { await button('同步失敗，重試同步').props.onPress(); });
    expect(boundary.flush).toHaveBeenCalled();
    expect(boundary.flush.mock.calls.length).toBeGreaterThan(flushCountBeforeRetry);
    expect(boundary.completions).not.toHaveBeenCalled();
    expect(boundary.completionRecord.syncStatus).toBe('CONFIRMED');
    expect(layout().props).toMatchObject({ completed: true, completionFailed: false, completionPending: false });
    expect(button('已完成，可撤銷完成確認')).toBeDefined();
  });
});
