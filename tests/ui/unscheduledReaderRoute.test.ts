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
const boundary = vi.hoisted(() => ({ sdk: null as any, sdkLoads: 0, positions: new Map<string, ReaderPosition>(), preferences: new Map<string, string>(), requests: [] as { versionId: number; usfm: string }[], completions: vi.fn(), session: { memberId: 'A', sessionToken: 'test-session' } }));
vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'), View: primitive('View'), Text: primitive('Text'), Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'),
  Modal: (props: { visible: boolean; children?: React.ReactNode }) => props.visible ? React.createElement('Modal', props, props.children) : null,
  StyleSheet: { create: (x: unknown) => x, absoluteFill: {} }, Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isScreenReaderEnabled: async () => false },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView'), useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) }));
vi.mock('expo-router', () => ({ router: { replace: vi.fn() }, useFocusEffect: (callback: () => any) => React.useEffect(callback, [callback]) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-operation' }));
vi.mock('expo-status-bar', () => ({ StatusBar: primitive('StatusBar') }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: Object.assign(primitive('NavigationBar'), { setHidden: vi.fn() }) }));
vi.mock('expo-audio', () => ({ useAudioPlayer: () => React.useMemo(() => ({ pause() {}, play() {}, replace() {}, seekTo: async () => {}, setPlaybackRate() {}, remove() {}, addListener: () => ({ remove() {} }), currentTime: 0, duration: 0, playing: false, isLoaded: false, isBuffering: false }), []) }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => boundary.preferences.get(key) ?? null, setItemAsync: async (key: string, value: string) => { boundary.preferences.set(key, value); } }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => ({ status: 'signed-in', session: boundary.session, epoch: 1, expiresAt: null }), getAuthSnapshot: () => ({ status: 'signed-in', session: boundary.session, epoch: 1, expiresAt: null }) }));
vi.mock('../../src/services/reminderScheduler', () => ({ createReminderScheduler: () => ({}) }));
vi.mock('../../src/services/reminderCompletion', () => ({ syncReadingReminderForCompletion: vi.fn() }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ saveCompletion: boundary.completions, getProgress: async () => undefined }) }));
vi.mock('../../src/storage/mobileDatabase', () => ({
  openQingmuRepository: () => ({ get: () => undefined, flush: async () => [], saveCompletion: boundary.completions }),
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
async function mount() { await act(async () => { rendered = TestRenderer.create(React.createElement(ReaderScreen)); }); }
beforeEach(() => {
  boundary.positions.clear(); boundary.preferences.clear(); boundary.requests = []; boundary.sdkLoads = 0; boundary.completions.mockClear();
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
    const text = all('Text').map(node => String(node.props.children)).join(' ');
    expect(text).not.toContain('官方閱讀器還在準備中');
    expect(text).not.toContain('正在取得本章語音');
  });
  it('uses the valid saved free-browse position on Sunday instead of the fallback', async () => {
    boundary.positions.set('A:2026-09-13', { memberId: 'A', planId: 'church-2026-09', taskDate: '2026-09-13', versionId: 312, book: 'PSA', chapter: '90', reference: 'PSA.90', mode: 'FREE_BROWSE', updatedAt: 'test' });
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
    await act(async () => all('ChapterSheet')[0].props.onSelect({ book: 'GEN', chapter: '2', versionId: 312 }));
    expect(reader().props).toMatchObject({ book: 'GEN', chapter: '2', versionId: 312 });
    expect(audio().props).toMatchObject({ chapterUsfm: 'GEN.2', versionId: 312 });
    await act(async () => setSelectedReadingDate('2026-09-12'));
    expect(layout().props.references).toEqual(['1TI.1', 'PSA.90', 'PSA.91']);
    expect(reader().props).toMatchObject({ book: '1TI', chapter: '1', versionId: 312 });
    expect(audio().props.chapterUsfm).toBe('1TI.1');
    act(() => layout().props.onSelectReference(2));
    expect(reader().props).toMatchObject({ book: 'PSA', chapter: '91' });
    expect(audio().props.chapterUsfm).toBe('PSA.91');
    expect(boundary.completions).not.toHaveBeenCalled();
  });
});
