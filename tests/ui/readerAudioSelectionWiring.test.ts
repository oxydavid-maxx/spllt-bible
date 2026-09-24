import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Review 120. THREE-LAYER integration on the ACTUAL caller:
//   ReaderScreen (real)  ->  YouVersionReader (real)  ->  ChapterAudioControls (real)  ->  capability request
// Only the boundaries are doubled: the native YouVersion SDK module, the reader-position store, and the
// network. Nothing feeds a "selected" value straight to a lower service - the whole point of 120 is that
// the previous proof did exactly that and therefore proved nothing about the wiring.

// These flags are read STATICALLY at module load (that is deliberate: babel inlines them in a
// production build). So they must be set before any import runs, which is what vi.hoisted gives us.
vi.hoisted(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.EXPO_PUBLIC_YOUVERSION_APP_KEY = 'test-app-key';
  process.env.EXPO_PUBLIC_QINGMU_YV_TEXT_PROBE = 'true';
  process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'true';
  process.env.EXPO_PUBLIC_QINGMU_AUDIO_AUTHORIZED = 'true';
  process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL = 'https://api.test.invalid';
});

const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => {
  const ReactRuntime = require('react') as typeof React;
  return ReactRuntime.createElement(name, props, props.children as React.ReactNode);
});

/** requests the REAL ChapterAudioControls actually issued, in order */
const recorded = vi.hoisted(() => ({ requests: [] as { versionId: number; usfm: string }[], cancels: 0, audioPlayCalls: 0, audioOwnerMounts: 0, journalSaves: [] as Array<Record<string, unknown>>, completionWrites: 0 }));
const completionController = vi.hoisted(() => ({
  record: { memberId: 'fixture:self', planId: 'church-2026-09', taskDate: '2026-09-12', status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' },
  pending: false,
  syncError: false,
  complete: vi.fn(async () => undefined),
  requestUndo: vi.fn(),
  options: [] as Array<Record<string, unknown>>,
}));
const navigationState = vi.hoisted(() => ({ pathname: '/reader' }));
const preferenceIO = vi.hoisted(() => {
  const data = new Map<string, string>();
  return { data, get: vi.fn(async (key: string) => data.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    alerts: [] as Array<{ title: string; message?: string; buttons?: Array<{ text?: string; onPress?: () => void }> }> };
});
const readerAuth = vi.hoisted(() => ({ memberId: null as string | null, epoch: 0, status: 'signed-out' as string }));
const readerSettings = vi.hoisted(() => ({ value: { fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 },
  listeners: new Set<(next: { fontSize: number; fontFamily: string; lineSpacing: number }) => void>() }));

vi.mock('expo-router', () => {
  const R = require('react') as typeof React;
  const Screen = (props: Record<string, unknown>) => R.createElement('Screen', props);
  const Tabs = (props: Record<string, unknown>) => R.createElement('Tabs', props, props.children as React.ReactNode);
  Object.assign(Tabs, { Screen });
  return {
    router: { replace: vi.fn() },
    usePathname: () => navigationState.pathname,
    // Exercise the real focus effect bodies, including cleanup; only navigation's native boundary is doubled.
    useFocusEffect: (effect: () => void | (() => void)) => R.useEffect(effect, [effect]),
    Tabs,
  };
});
vi.mock('expo-status-bar', () => ({ StatusBar: primitive('StatusBar') }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: Object.assign(primitive('NavigationBar'), { setHidden: vi.fn() }) }));
vi.mock('expo-audio', () => ({
  useAudioPlayer: () => {
    const R = require('react') as typeof React;
    // The real hook holds one instance across renders. Remain inert: this lane proves selection only.
    const ref = R.useRef<object | null>(null);
    if (!ref.current) {
      recorded.audioOwnerMounts += 1;
      ref.current = {
        play: () => { recorded.audioPlayCalls += 1; }, pause: () => undefined, replace: () => undefined,
        addListener: () => ({ remove: () => undefined }),
        seekTo: async () => undefined, setPlaybackRate: () => undefined, remove: () => undefined,
        currentTime: 0, duration: 0, playing: false, isLoaded: false, isBuffering: false,
      };
    }
    return ref.current;
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixture-operation') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: (key: string) => preferenceIO.get(key), setItemAsync: (key: string, value: string) => preferenceIO.set(key, value) }));
vi.mock('expo-application', () => ({ nativeBuildVersion: '30' }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(), maybeCompleteAuthSession() {} }));
vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'),
  KeyboardAvoidingView: primitive('KeyboardAvoidingView'),
  Keyboard: { isVisible: () => false, addListener: () => ({ remove() {} }) },
  Platform: { OS: 'android' },
  useWindowDimensions: () => ({ width: 393, fontScale: 1 }),
  Modal: (props: { visible: boolean; children?: React.ReactNode }) => props.visible ? React.createElement('Modal', props, props.children) : null,
  BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  AccessibilityInfo: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    isScreenReaderEnabled: vi.fn(async () => false),
  },
  Alert: { alert: (title: string, message?: string, buttons?: Array<{ text?: string; onPress?: () => void }>) => preferenceIO.alerts.push({ title, message, buttons }) },
  Pressable: primitive('Pressable'),
  ScrollView: primitive('ScrollView'),
  StyleSheet: { create: (value: unknown) => value },
  Text: primitive('Text'),
  TextInput: primitive('TextInput'), View: primitive('View'),
  Linking: { openURL: vi.fn(async () => undefined) },
}));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: () => React.createElement('Pressable', { accessibilityRole: 'button', accessibilityLabel: '開啟帳戶', onPress: vi.fn() } as never) }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView'), useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: primitive('Icon') }));
vi.mock('../../src/ui/BibleContentPreloadHost', () => ({ BibleContentPreloadHost: () => null }));
vi.mock('../../src/ui/completionFeedback', () => ({ CompletionFeedback: () => React.createElement('CompletionFeedback') }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({
  CompletionAwardFeedback: ({ event }: { event: unknown }) => event ? React.createElement('CompletionAwardPreview', { event }) : null,
}));
vi.mock('../../src/services/authSession', () => ({
  useAuthSnapshot: () => ({ status: readerAuth.status, session: readerAuth.memberId ? { memberId: readerAuth.memberId, sessionToken: 'memory-session' } : null, epoch: readerAuth.epoch }),
  getAuthSnapshot: () => ({ status: readerAuth.status, session: readerAuth.memberId ? { memberId: readerAuth.memberId, sessionToken: 'memory-session' } : null, epoch: readerAuth.epoch, expiresAt: null }),
  isCurrentAuthSession: (session: { memberId?: string } | null) => session?.memberId === readerAuth.memberId,
}));
vi.mock('../../src/services/reminderScheduler', () => ({ createReminderScheduler: () => ({}) }));
vi.mock('../../src/services/reminderCompletion', () => ({ syncReadingReminderForCompletion: vi.fn() }));
vi.mock('../../src/services/journalApiClient', () => ({ createJournalApiClient: () => ({ listEntries: async () => null }) }));
vi.mock('../../src/services/useOutboxRecovery', () => ({ useOutboxRecovery: () => undefined }));
vi.mock('../../src/services/useCompletionController', () => ({
  useCompletionController: (options: Record<string, unknown>) => {
    completionController.options.push(options);
    return { record: completionController.record, pending: completionController.pending, syncError: completionController.syncError,
      retryable: completionController.record.syncStatus === 'SAVE_FAILED',
      complete: completionController.complete, requestUndo: completionController.requestUndo };
  },
}));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: vi.fn() }));

// two assigned passages for the day: this is what "第二指定段" means
// two dates with DIFFERENT assigned passages, so a date change is observable at all (C5)
vi.mock('../../src/ui/routes', () => ({
  buildFixtureModels: (date: string) => ({
    reader: { references: date === '2026-09-03' ? ['PSA.88', 'PSA.89'] : ['JHN.19', 'JHN.20'] },
  }),
}));

// in-memory reader position store, so free-browse positions really persist within the test
vi.mock('../../src/storage/mobileDatabase', () => {
  // one shared in-memory position, matching the real store's interface exactly
  const state: { saved: Record<string, unknown> | undefined } = { saved: undefined };
  const store = {
    get: (_memberId: string, _planId: string, taskDate: string) =>
      (state.saved && state.saved.taskDate === taskDate ? state.saved : undefined),
    save: (p: Record<string, unknown>) => { state.saved = p; },
    resetToAssigned: (memberId: string, planId: string, taskDate: string, references: string[]) => {
      const [book, chapter] = (references[0] ?? 'JHN.1').split('.');
      state.saved = { memberId, planId, taskDate, versionId: 46, book, chapter, reference: references[0], mode: 'ASSIGNED', updatedAt: 'test' };
    },
    __reset: () => { state.saved = undefined; },
    __saved: () => state.saved,
  };
  return {
    openQingmuRepository: vi.fn(() => ({ get: vi.fn(() => undefined), flush: vi.fn(async () => []), saveCompletion: vi.fn((command: Record<string, unknown>) => { recorded.completionWrites += 1; return command; }) })),
    openQingmuReaderPositionStore: vi.fn(() => store),
    openQingmuJournalStore: vi.fn(() => ({
      get: (identity: { memberId: string; taskDate: string }) => {
        const saved = recorded.journalSaves.find(command => command.memberId === identity.memberId && command.taskDate === identity.taskDate);
        return saved ? { ...saved, revision: 1, syncStatus: 'CONFIRMED', updatedAt: 'test' } : null;
      },
      list: (memberId: string) => recorded.journalSaves.filter(command => command.memberId === memberId).map(command => ({ taskDate: command.taskDate, body: command.body })),
      save: (command: Record<string, unknown>) => { recorded.journalSaves.push(command); return { ...command, revision: 1, syncStatus: 'CONFIRMED', updatedAt: 'test' }; },
    })),
  };
});

// the native SDK boundary: a reader module whose BibleReader just exposes its props to the test
vi.mock('../../src/services/youVersionAdapter', () => ({
  createYouVersionAdapter: () => ({
    loadReaderUi: async () => ({
      status: 'READER_UI_READY',
      module: {
        getReaderSettings: () => ({ ...readerSettings.value }),
        getDefaultReaderSettings: () => ({ fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }),
        setReaderSettings: (next: Partial<typeof readerSettings.value>) => { readerSettings.value = { ...readerSettings.value, ...next }; readerSettings.listeners.forEach(listener => listener({ ...readerSettings.value })); },
        subscribeReaderSettings: (listener: (next: typeof readerSettings.value) => void) => { readerSettings.listeners.add(listener); return () => { readerSettings.listeners.delete(listener); }; },
        YouVersionProvider: (props: { children?: unknown }) => React.createElement('YVProvider', props, props.children as React.ReactNode),
        BibleReader: (props: Record<string, unknown>) => React.createElement('BibleReader', props),
        BibleReaderSettingsSheet: (props: Record<string, unknown>) => React.createElement('OfficialSettingsSheet', props),
        BibleChapterPickerSheet: (props: Record<string, unknown>) => React.createElement('OfficialChapterPicker', props),
        BibleVersionPickerSheet: (props: Record<string, unknown>) => React.createElement('OfficialVersionPicker', props),
      },
    }),
  }),
}));

// the network boundary: record exactly what the real component asked for
vi.mock('../../src/services/contentCapabilityClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/contentCapabilityClient')>();
  return {
    ...actual,
    createCapabilityCoordinator: () => ({
      generation: () => 0,
      cancel: () => { recorded.cancels += 1; },
      request: async (identity: { versionId: number; usfm: string }) => {
        recorded.requests.push({ ...identity });
        // answer PLAYABLE for whatever was asked, with that chapter's own reference, so the rendered
        // label is real evidence that the surface names the same chapter the request named
        const { formatReferenceZhTw } = await import('../../src/domain/scriptureReference');
        return {
          kind: 'playable' as const,
          identity,
          capability: {
            identity,
            text: true,
            audio: true,
            offline: false as const,
            status: 'verified_source' as const,
            reason: '',
            uri: `https://cdn.test.invalid/${identity.usfm}.mp3`,
            providerExpiry: null,
            validUntil: new Date('2030-01-01T00:00:00.000Z').toISOString(),
            provenance: {
              publisher: 'Biblica',
              edition: '當代譯本(繁體)',
              recordingId: '1320',
              reference: formatReferenceZhTw(identity.usfm) || identity.usfm,
              attribution: 'test attribution',
            },
          },
        };
      },
    }),
  };
});

import ReaderScreen from '../../app/(tabs)/reader';
import JournalScreen from '../../app/(tabs)/journal';
import TabsLayout from '../../app/(tabs)/_layout';
import { FullscreenReaderLayout } from '../../src/ui/FullscreenReaderLayout';
import { YouVersionReader } from '../../src/ui/YouVersionReader';

type Node = TestRenderer.ReactTestInstance;

/** the day whose plan is JHN.19 / JHN.20 in the mock above */
const BASE_DATE = '2026-09-12';

function audioChapter(renderer: TestRenderer.ReactTestRenderer): string | undefined {
  // the chapter the REAL ChapterAudioControls was actually given, read off its rendered output
  const block = renderer.root.findAll((n: Node) => typeof n.props?.accessibilityLabel === 'string'
    && (n.props.accessibilityLabel as string).startsWith('章節語音'));
  return block[0]?.props.accessibilityLabel as string | undefined;
}

function pressByLabel(renderer: TestRenderer.ReactTestRenderer, label: string): void {
  const target = renderer.root.findAll((n: Node) => n.props?.accessibilityLabel === label
    && typeof n.props?.onPress === 'function' && isReachable(renderer, n))[0];
  if (!target) throw new Error(`no reachable pressable labelled ${label}`);
  act(() => { target.props.onPress(); });
}

function isReachable(renderer: TestRenderer.ReactTestRenderer, node: Node): boolean {
  const modals = renderer.root.findAll((n: Node) => String(n.type) === 'Modal' && n.props.visible);
  let insideModal = false;
  for (let current: Node | null = node; current; current = current.parent) {
    if (modals.includes(current)) insideModal = true;
    if (current.props?.disabled || current.props?.accessibilityElementsHidden
      || current.props?.importantForAccessibility === 'no-hide-descendants'
      || current.props?.pointerEvents === 'none' || current.props?.isOpen === false
      || current.props?.isSettingsSheetOpen === false) return false;
  }
  return modals.length === 0 || insideModal;
}

function revealReaderTools(renderer: TestRenderer.ReactTestRenderer): void {
  const toolbar = renderer.root.findAll((n: Node) => n.props?.accessibilityLabel === '閱讀工具列')[0];
  expect(toolbar).toBeDefined();
  if (!isReachable(renderer, toolbar)) {
    const reader = bibleReader(renderer);
    act(() => { reader.props.dom.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'qingmu.reader.canvas.tap', data: null }) } }); });
  }
  expect(renderer.root.findAll((n: Node) => n.props?.accessibilityLabel === '閱讀工具列'
    && isReachable(renderer, n)).length).toBeGreaterThan(0);
}

function openMore(renderer: TestRenderer.ReactTestRenderer): void {
  revealReaderTools(renderer);
  pressByLabel(renderer, '更多閱讀工具');
  expect(renderer.root.findAll((n: Node) => String(n.type) === 'Modal' && n.props.visible)).toHaveLength(1);
}

function selectAssigned(renderer: TestRenderer.ReactTestRenderer, referenceLabel: string): void {
  pressByLabel(renderer, '選擇今日章節清單');
  pressByLabel(renderer, `前往${referenceLabel}`);
  expect(renderer.root.findAll((n: Node) => String(n.type) === 'Modal' && n.props.visible)).toHaveLength(0);
}

function readerLayout(renderer: TestRenderer.ReactTestRenderer): Node {
  return renderer.root.findByType(FullscreenReaderLayout);
}

async function selectDateInReader(renderer: TestRenderer.ReactTestRenderer, date: string): Promise<void> {
  for (let step = 0; step < 40 && readerLayout(renderer).props.selectedDate !== date; step += 1) {
    const current = String(readerLayout(renderer).props.selectedDate);
    pressByLabel(renderer, current > date ? '上一個排定讀經日' : '下一個排定讀經日');
    await act(async () => { await Promise.resolve(); });
  }
  expect(readerLayout(renderer).props.selectedDate).toBe(date);
}

function bibleReader(renderer: TestRenderer.ReactTestRenderer): Node {
  const found = renderer.root.findAll((n: Node) => String(n.type) === 'BibleReader')[0];
  if (!found) throw new Error('BibleReader not rendered');
  return found;
}

async function mount(): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(ReaderScreen)); });
  await act(async () => { await Promise.resolve(); });
  return renderer;
}

const lastRequest = () => recorded.requests[recorded.requests.length - 1];

async function pressTodayTabFrom(pathname = '/progress'): Promise<void> {
  navigationState.pathname = pathname;
  let tabsRenderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { tabsRenderer = TestRenderer.create(React.createElement(TabsLayout)); });
  const tabs = tabsRenderer.root.findAll((node: Node) => String(node.type) === 'Tabs')[0];
  if (!tabs) throw new Error('Tabs layout was not rendered');
  const listeners = tabs.props.screenListeners as ((props: { route: { name: string }; navigation: object }) => { tabPress?: (event: { defaultPrevented: boolean }) => void }) | undefined;
  const todayTabPress = listeners?.({ route: { name: 'today' }, navigation: {} }).tabPress;
  if (!todayTabPress) throw new Error('today tabPress entry handler is not wired');
  act(() => { todayTabPress({ defaultPrevented: false }); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { tabsRenderer.unmount(); });
}

const pressTodayTabFromPoints = (): Promise<void> => pressTodayTabFrom('/progress');

async function configureTodayReferences(references: string[]) {
  const calendar = await import('../../src/domain/calendar');
  const session = await import('../../src/ui/readingSession');
  const { taipeiDate } = await import('../../src/domain/gamificationV1');
  const today = taipeiDate();
  const days = [...calendar.canonicalSeptemberPlan.days.filter(day => day.date !== today), { date: today, sourceRows: [], references }]
    .sort((left, right) => left.date.localeCompare(right.date));
  session.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days, dates: days.map(day => day.date), uniqueReferences: [...new Set(days.flatMap(day => day.references))] });
  session.setSelectedReadingDate(today);
  return { session, today };
}

// FILE-level reset. A describe-scoped beforeEach left later suites reading the previous suite's saved
// position and reading date, which is test pollution rather than product behaviour.
beforeEach(async () => {
  process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'true';
  readerAuth.memberId = null; readerAuth.epoch = 0; readerAuth.status = 'signed-out';
  preferenceIO.data.clear(); preferenceIO.alerts.length = 0;
  preferenceIO.get.mockReset().mockImplementation(async key => preferenceIO.data.get(key) ?? null);
  preferenceIO.set.mockReset().mockImplementation(async (key, value) => { preferenceIO.data.set(key, value); });
  readerSettings.value = { fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }; readerSettings.listeners.clear();
  recorded.requests.length = 0;
  recorded.cancels = 0;
  recorded.audioPlayCalls = 0;
  recorded.audioOwnerMounts = 0;
  recorded.journalSaves.length = 0;
  completionController.record = { memberId: 'fixture:self', planId: 'church-2026-09', taskDate: BASE_DATE, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
  completionController.pending = false;
  completionController.syncError = false;
  completionController.complete.mockReset().mockResolvedValue(undefined);
  completionController.requestUndo.mockReset();
  completionController.options.length = 0;
  recorded.completionWrites = 0;
  navigationState.pathname = '/reader';
  const db = await import('../../src/storage/mobileDatabase');
  (db.openQingmuReaderPositionStore() as unknown as { __reset: () => void }).__reset();
  const rs = await import('../../src/ui/readingSession');
  const calendar = await import('../../src/domain/calendar');
  const days = calendar.canonicalSeptemberPlan.days.map(day => day.date === BASE_DATE
    ? { ...day, references: ['JHN.19', 'JHN.20'] }
    : day.date === '2026-09-03'
      ? { ...day, references: ['PSA.88', 'PSA.89'] }
      : day);
  rs.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days, uniqueReferences: [...new Set(days.flatMap(day => day.references))] });
  rs.setSelectedReadingDate(BASE_DATE);
  rs.setJournalEntryDate(BASE_DATE);
  rs.consumePendingJournalQuote();
});

describe('the chapter the audio asks for follows the ACTUAL reader selection (120 R1)', () => {
  const originalError = console.error;
  const env = { ...process.env };
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      const m = String(args[0] ?? '');
      if (m.includes('react-test-renderer is deprecated') || m.includes('testing environment is not configured to support act') || m.includes('An update to ReaderScreen inside a test was not wrapped in act')) return;
      originalError(...args);
    };
  });
  afterAll(() => { console.error = originalError; process.env = env; });

  it('keeps one Reader audio owner mounted and makes that same player controllable in Diary', async () => {
    readerAuth.memberId = 'fixture:self';
    readerAuth.status = 'signed-in';
    let renderer!: TestRenderer.ReactTestRenderer;
    const readerAndDiary = (showDiary: boolean) => React.createElement(React.Fragment, null,
      React.createElement(ReaderScreen),
      showDiary ? React.createElement(JournalScreen) : null,
    );
    await act(async () => { renderer = TestRenderer.create(readerAndDiary(false)); await Promise.resolve(); });
    const ownerMountsBeforeDiary = recorded.audioOwnerMounts;

    navigationState.pathname = '/journal';
    await act(async () => {
      renderer.update(readerAndDiary(true));
      for (let step = 0; step < 8; step += 1) await Promise.resolve();
    });
    const diaryHost = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '日記朗讀控制')[0];
    expect(diaryHost).toBeDefined();
    expect(recorded.audioOwnerMounts).toBe(ownerMountsBeforeDiary);

    const play = diaryHost.findAll((node: Node) => node.props?.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0];
    expect(play).toBeDefined();
    expect(play.props.disabled).not.toBe(true);
    expect(recorded.completionWrites).toBe(0);
    expect(recorded.audioOwnerMounts).toBe(ownerMountsBeforeDiary);
    const readerChapterBeforeDiaryDate = audioChapter(renderer);
    const nextDiaryDate = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '後一天日記')[0];
    await act(async () => { nextDiaryDate.props.onPress(); await Promise.resolve(); });
    expect(readerLayout(renderer).props.selectedDate).toBe(BASE_DATE);
    expect(audioChapter(renderer)).toBe(readerChapterBeforeDiaryDate);
    expect(recorded.audioOwnerMounts).toBe(ownerMountsBeforeDiary);
    await act(async () => { renderer.unmount(); });
  });

  it('flushes a Diary draft before changing its editor date without changing Reader taskDate', async () => {
    readerAuth.memberId = 'fixture:self';
    readerAuth.status = 'signed-in';
    const session = await import('../../src/ui/readingSession');
    session.setJournalEntryDate('2026-09-22');
    navigationState.pathname = '/journal';
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(JournalScreen)); });
    const input = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '靈修日記')[0];
    expect(input).toBeDefined();
    act(() => input.props.onChangeText('換日之前先保存這段'));
    const nextDay = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '後一天日記')[0];
    expect(nextDay).toBeDefined();
    await act(async () => { nextDay.props.onPress(); await Promise.resolve(); });
    expect(recorded.journalSaves[0]).toMatchObject({ taskDate: '2026-09-22', body: '換日之前先保存這段' });
    expect(renderer.root.findAll((node: Node) => String(node.type) === 'Text').map(node => String(node.props.children)).join(' ')).toContain('9/23');
    expect(session.getReadingSessionSnapshot().selectedDate).toBe(BASE_DATE);
    await act(async () => { renderer.unmount(); });
  });

  it('refreshes Diary history after the first debounced save', async () => {
    vi.useFakeTimers();
    readerAuth.memberId = 'fixture:self';
    readerAuth.status = 'signed-in';
    navigationState.pathname = '/journal';
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(JournalScreen)); await Promise.resolve(); });
    const input = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '靈修日記')[0];
    act(() => { input.props.onChangeText('第一篇日記'); });
    expect(renderer.root.findAll((node: Node) => String(node.type) === 'Pressable' && node.props?.accessibilityLabel === '匯出靈修日記')).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(2_100); await Promise.resolve(); });
    expect(renderer.root.findAll((node: Node) => String(node.type) === 'Pressable' && node.props?.accessibilityLabel === '匯出靈修日記')).toHaveLength(1);
    expect(renderer.root.findAll((node: Node) => String(node.type) === 'Pressable' && typeof node.props?.accessibilityLabel === 'string'
      && node.props.accessibilityLabel.startsWith('開啟 ') && node.props.accessibilityLabel.endsWith(' 的日記'))).toHaveLength(1);
    await act(async () => { renderer.unmount(); });
    vi.useRealTimers();
  });

  it('keeps chapter selection, icon-only completion, and play together in the Reader action row', async () => {
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    (await import('../../src/ui/readingSession')).setSelectedReadingDate(taipeiDate());
    const renderer = await mount();
    const bottom = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '讀經控制列')[0];
    expect(bottom).toBeDefined();
    const actions = bottom.findAll((node: Node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'button');
    expect(actions.some((node: Node) => node.props.accessibilityLabel === '選擇今日章節清單')).toBe(true);
    expect(actions.some((node: Node) => node.props.accessibilityLabel === '靈修日記')).toBe(false);
    const completion = actions.find((node: Node) => node.props.accessibilityState?.checked === false
      && String(node.props.accessibilityHint).includes('長按查看完成狀態說明'));
    expect(completion).toBeDefined();
    expect(completion?.props.accessibilityState.disabled).toBe(false);
    expect(completion?.findAll((node: Node) => String(node.type) === 'Text')).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
  });

  it('sends the selected task identity to the shared completion controller and uses its actions', async () => {
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    const today = taipeiDate();
    const session = await import('../../src/ui/readingSession');
    session.setSelectedReadingDate(today);
    completionController.record = { memberId: 'fixture:self', planId: 'church-2026-09', taskDate: today, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
    const renderer = await mount();
    const options = completionController.options.at(-1)!;
    expect(options).toMatchObject({ planId: 'church-2026-09', taskDate: today, canComplete: true });
    const complete = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '完成讀經' && typeof node.props?.onPress === 'function')[0];
    expect(complete).toBeDefined();
    expect(complete.props.accessibilityState.disabled).toBe(false);
    await act(async () => { complete.props.onPress(); await Promise.resolve(); });
    expect(completionController.complete).toHaveBeenCalledOnce();
    expect(recorded.completionWrites).toBe(0);
    await act(async () => { renderer.unmount(); });
  });

  it('forwards the confirmed award with its original date instead of relabelling it as today', async () => {
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    const session = await import('../../src/ui/readingSession');
    session.setSelectedReadingDate(taipeiDate());
    const renderer = await mount();
    expect(renderer.root.findAll((node: Node) => String(node.type) === 'CompletionAwardPreview')).toHaveLength(0);
    const options = completionController.options.at(-1)!;
    const event = { memberId: 'fixture:self', planId: 'church-2026-09', taskDate: '2026-09-23', operationId: 'award-yesterday-1', pointsDelta: 2, earnedTotal: 9 };
    await act(async () => { (options.onAward as (value: typeof event) => void)(event); });
    const feedback = renderer.root.findAll((node: Node) => String(node.type) === 'CompletionAwardPreview')[0];
    expect(feedback).toBeDefined();
    expect(feedback.props.event).toEqual(event);
    expect(recorded.completionWrites).toBe(0);
    await act(async () => { renderer.unmount(); });
  });

  it('uses the shared controller undo action for an already completed Reader date', async () => {
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    const today = taipeiDate();
    (await import('../../src/ui/readingSession')).setSelectedReadingDate(today);
    completionController.record = { memberId: 'fixture:self', planId: 'church-2026-09', taskDate: today, status: 'COMPLETED', revision: 1, syncStatus: 'CONFIRMED' };
    const renderer = await mount();
    const complete = renderer.root.findAll((node: Node) => node.props?.accessibilityRole === 'button'
      && node.props.accessibilityState?.checked === true)[0];
    expect(complete).toBeDefined();
    expect(complete.props.accessibilityLabel).toBe('已完成，可撤銷完成確認');
    expect(complete.props.accessibilityState.disabled).toBe(false);
    await act(async () => { complete.props.onPress(); });
    expect(completionController.requestUndo).toHaveBeenCalledOnce();
    await act(async () => { renderer.unmount(); });
  });

  it('offers a Reader-copied verse in Diary and inserts it only after an explicit tap', async () => {
    readerAuth.memberId = 'fixture:self';
    readerAuth.status = 'signed-in';
    const session = await import('../../src/ui/readingSession');
    session.setJournalEntryDate(BASE_DATE);
    session.setPendingJournalQuote('「主所賜的不是膽怯的心」提後 1:7');
    navigationState.pathname = '/journal';
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(JournalScreen)); });
    const input = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '靈修日記')[0];
    expect(input.props.value).toBe('');
    const offer = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '插入剛複製的經文')[0];
    expect(offer).toBeDefined();
    await act(async () => { offer.props.onPress(); });
    expect(input.props.value).toContain('「主所賜的不是膽怯的心」提後 1:7');
    expect(session.getReadingSessionSnapshot().pendingJournalQuote).toBeNull();
    await act(async () => { renderer.unmount(); });
  });

  it('returns same-day FREE_BROWSE GEN.1 to today TIT.1 only on an explicit tabPress', async () => {
    const calendar = await import('../../src/domain/calendar');
    const session = await import('../../src/ui/readingSession');
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    const today = taipeiDate();
    const days = [...calendar.canonicalSeptemberPlan.days.filter(day => day.date !== today), { date: today, sourceRows: [], references: ['TIT.1'] }].sort((a, b) => a.date.localeCompare(b.date));
    session.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days, dates: days.map(day => day.date), uniqueReferences: [...new Set(days.flatMap(day => day.references))] });
    session.setSelectedReadingDate(today);

    const renderer = await mount();
    expect(lastRequest()?.usfm).toBe('TIT.1');
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onBookChange('GEN'); });
    await act(async () => { await reader.props.onChapterChange('1'); });
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('GEN.1');
    expect(await savedRow()).toMatchObject({ mode: 'FREE_BROWSE', taskDate: today, reference: 'GEN.1' });

    await pressTodayTabFromPoints();
    await act(async () => { await Promise.resolve(); });

    expect(session.getReadingSessionSnapshot()).toMatchObject({ selectedDate: today });
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('TIT.1');
    expect(lastRequest()?.usfm).toBe('TIT.1');
    expect(await savedRow()).toMatchObject({ mode: 'ASSIGNED', taskDate: today, reference: 'TIT.1' });
    expect(recorded.audioPlayCalls).toBe(0);
    expect(recorded.completionWrites).toBe(0);
    await act(async () => { renderer.unmount(); });
  });

  it.each(['/progress', '/announcements'])('resets a manually selected same-day PSA.100 to TIT.1 on explicit Today entry from %s', async sourcePath => {
    const { today } = await configureTodayReferences(['TIT.1', 'PSA.99', 'PSA.100']);
    const renderer = await mount();
    selectAssigned(renderer, '詩100');
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('PSA.100');
    expect(await savedRow()).toMatchObject({ mode: 'ASSIGNED', taskDate: today, reference: 'PSA.100' });

    await pressTodayTabFrom(sourcePath);
    await act(async () => { await Promise.resolve(); });

    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('TIT.1');
    expect(lastRequest()?.usfm).toBe('TIT.1');
    expect(await savedRow()).toMatchObject({ mode: 'ASSIGNED', taskDate: today, reference: 'TIT.1' });
    expect(recorded.audioPlayCalls).toBe(0);
    expect(recorded.completionWrites).toBe(0);
    await act(async () => { renderer.unmount(); });
  });

  it('preserves EOF-advanced PSA.100 and its shared audio binding on Diary return, then resets on Points→Today', async () => {
    readerAuth.memberId = 'fixture:self';
    readerAuth.status = 'signed-in';
    const { today } = await configureTodayReferences(['TIT.1', 'PSA.99', 'PSA.100']);
    await act(async () => { for (let step = 0; step < 8; step += 1) await Promise.resolve(); });
    const readerAndDiary = (showDiary: boolean) => React.createElement(React.Fragment, null,
      React.createElement(ReaderScreen),
      showDiary ? React.createElement(JournalScreen) : null,
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(readerAndDiary(false)); await Promise.resolve(); });
    selectAssigned(renderer, '詩99');
    const audioOwnerMountsBeforeDiary = recorded.audioOwnerMounts;

    navigationState.pathname = '/journal';
    await act(async () => { renderer.update(readerAndDiary(true)); await Promise.resolve(); });
    const reader = renderer.root.findByType(YouVersionReader);
    expect(reader.props.activeReferenceIndex).toBe(1);
    // handlePlaybackEnded's real EOF branch emits this controlled-selection callback; its
    // end-to-end emission is covered by readerAutoplayNativeFlow.test.ts.
    await act(async () => {
      reader.props.onActiveReferenceChange(2);
    });
    await act(async () => { await Promise.resolve(); });
    const playsBeforeDiaryReturn = recorded.audioPlayCalls;
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('PSA.100');
    expect(readerLayout(renderer).props.chapterUsfm).toBe('PSA.100');
    expect(await savedRow()).toMatchObject({ mode: 'ASSIGNED', taskDate: today, reference: 'PSA.100' });
    expect(recorded.audioPlayCalls).toBe(0);

    const session = await import('../../src/ui/readingSession');
    const beforeDiaryReturnRevision = session.getReadingSessionSnapshot().todayReaderTabPressRevision;
    let tabsRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { tabsRenderer = TestRenderer.create(React.createElement(TabsLayout)); });
    const tabs = tabsRenderer.root.findAll((node: Node) => String(node.type) === 'Tabs')[0];
    const listeners = tabs.props.screenListeners as (input: { route: { name: string } }) => { tabPress?: (event: { defaultPrevented: boolean; preventDefault?: () => void }) => void };
    const diaryReturn = { defaultPrevented: false, preventDefault: vi.fn() };
    act(() => { listeners({ route: { name: 'today' } }).tabPress!(diaryReturn); });
    expect(diaryReturn.preventDefault).toHaveBeenCalledOnce();
    await act(async () => { tabsRenderer.unmount(); });
    navigationState.pathname = '/reader';
    await act(async () => { renderer.update(readerAndDiary(false)); await Promise.resolve(); });
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('PSA.100');
    expect(readerLayout(renderer).props.chapterUsfm).toBe('PSA.100');
    expect(session.getReadingSessionSnapshot().todayReaderTabPressRevision).toBe(beforeDiaryReturnRevision);
    expect(recorded.audioPlayCalls).toBe(playsBeforeDiaryReturn);
    expect(recorded.audioOwnerMounts).toBe(audioOwnerMountsBeforeDiary);

    await pressTodayTabFrom('/progress');
    await act(async () => { await Promise.resolve(); });
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('TIT.1');
    expect(readerLayout(renderer).props.chapterUsfm).toBe('TIT.1');
    expect(lastRequest()?.usfm).toBe('TIT.1');
    expect(await savedRow()).toMatchObject({ mode: 'ASSIGNED', taskDate: today, reference: 'TIT.1' });
    expect(recorded.audioPlayCalls).toBe(playsBeforeDiaryReturn);
    expect(recorded.completionWrites).toBe(0);
    await act(async () => { renderer.unmount(); });
  });

  it('keeps a tabPress pending until today references hydrate', async () => {
    const calendar = await import('../../src/domain/calendar');
    const session = await import('../../src/ui/readingSession');
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    const today = taipeiDate();
    const daysWithoutToday = calendar.canonicalSeptemberPlan.days.filter(day => day.date !== today);
    session.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days: daysWithoutToday, dates: daysWithoutToday.map(day => day.date), uniqueReferences: [...new Set(daysWithoutToday.flatMap(day => day.references))] });
    session.setSelectedReadingDate(today);

    const renderer = await mount();
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onBookChange('GEN'); });
    await act(async () => { await reader.props.onChapterChange('1'); });
    await pressTodayTabFromPoints();
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('GEN.1');
    expect(await savedRow()).toMatchObject({ mode: 'FREE_BROWSE', reference: 'GEN.1' });

    const hydratedDays = [...daysWithoutToday, { date: today, sourceRows: [], references: ['TIT.1'] }].sort((left, right) => left.date.localeCompare(right.date));
    await act(async () => {
      session.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days: hydratedDays, dates: hydratedDays.map(day => day.date), uniqueReferences: [...new Set(hydratedDays.flatMap(day => day.references))] });
      await Promise.resolve();
    });

    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('TIT.1');
    expect(await savedRow()).toMatchObject({ mode: 'ASSIGNED', taskDate: today, reference: 'TIT.1' });
    await act(async () => { renderer.unmount(); });
  });

  it('drops a no-plan Today tab intent when a date arrow moves to another scheduled day', async () => {
    const calendar = await import('../../src/domain/calendar');
    const session = await import('../../src/ui/readingSession');
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    const today = taipeiDate();
    const days = calendar.canonicalSeptemberPlan.days.filter(day => day.date !== today);
    session.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days, dates: days.map(day => day.date), uniqueReferences: [...new Set(days.flatMap(day => day.references))] });
    session.setSelectedReadingDate(today);

    const renderer = await mount();
    expect(readerLayout(renderer).props.noPlanMessage).toBeTruthy();
    const targetDate = (readerLayout(renderer).props.nextDate ?? readerLayout(renderer).props.previousDate) as string;
    expect(targetDate).toBeTruthy();
    const targetPlanId = session.getReadingPlanId(targetDate) ?? calendar.canonicalSeptemberPlan.planId;
    const db = await import('../../src/storage/mobileDatabase');
    (db.openQingmuReaderPositionStore() as unknown as { save: (row: Record<string, unknown>) => void }).save({
      memberId: 'fixture:self', planId: targetPlanId, taskDate: targetDate, versionId: 46,
      book: 'GEN', chapter: '2', reference: 'GEN.2', mode: 'FREE_BROWSE', updatedAt: 'test',
    });

    await pressTodayTabFromPoints();
    expect(session.getReadingSessionSnapshot()).toMatchObject({ selectedDate: today });
    const arrowLabel = readerLayout(renderer).props.nextDate ? '下一個排定讀經日' : '上一個排定讀經日';
    pressByLabel(renderer, arrowLabel);
    await act(async () => { await Promise.resolve(); });

    expect(session.getReadingSessionSnapshot()).toMatchObject({ selectedDate: targetDate, todayReaderTabPressTargetDate: null });
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('GEN.2');
    expect(lastRequest()?.usfm).toBe('GEN.2');
    expect(await savedRow()).toMatchObject({ taskDate: targetDate, mode: 'FREE_BROWSE', reference: 'GEN.2' });
    await act(async () => { renderer.unmount(); });
  });

  it('waits for Reader owner readiness and drops a tabPress owned by another account', async () => {
    const session = await import('../../src/ui/readingSession');
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    const calendar = await import('../../src/domain/calendar');
    const today = taipeiDate();
    const days = [...calendar.canonicalSeptemberPlan.days.filter(day => day.date !== today), { date: today, sourceRows: [], references: ['TIT.1'] }].sort((a, b) => a.date.localeCompare(b.date));
    session.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days, dates: days.map(day => day.date), uniqueReferences: [...new Set(days.flatMap(day => day.references))] });
    session.setSelectedReadingDate(today);
    readerAuth.status = 'hydrating';
    const renderer = await mount();
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onBookChange('GEN'); });
    await act(async () => { await reader.props.onChapterChange('1'); });
    await pressTodayTabFromPoints();
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('GEN.1');

    readerAuth.status = 'signed-out';
    await act(async () => { renderer.update(React.createElement(ReaderScreen)); await Promise.resolve(); });
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('TIT.1');
    await act(async () => { renderer.unmount(); });

    readerAuth.memberId = 'account-b';
    readerAuth.epoch = 2;
    readerAuth.status = 'signed-in';
    const db = await import('../../src/storage/mobileDatabase');
    (db.openQingmuReaderPositionStore() as unknown as { save: (row: Record<string, unknown>) => void }).save({
      memberId: 'account-b', planId: calendar.canonicalSeptemberPlan.planId, taskDate: today, versionId: 46,
      book: 'GEN', chapter: '1', reference: 'GEN.1', mode: 'FREE_BROWSE', updatedAt: 'test',
    });
    session.requestTodayReaderTabPress(today, 'account-a', 1);
    const accountBRenderer = await mount();
    expect(`${bibleReader(accountBRenderer).props.book}.${bibleReader(accountBRenderer).props.chapter}`).toBe('GEN.1');
    expect(await savedRow()).toMatchObject({ memberId: 'account-b', mode: 'FREE_BROWSE', reference: 'GEN.1' });
    await act(async () => { accountBRenderer.unmount(); });
  });

  it('leaves free browse alone on a scheduled rest day without replaying the pending event', async () => {
    const calendar = await import('../../src/domain/calendar');
    const session = await import('../../src/ui/readingSession');
    const { taipeiDate } = await import('../../src/domain/gamificationV1');
    const today = taipeiDate();
    const days = [...calendar.canonicalSeptemberPlan.days.filter(day => day.date !== today), { date: today, sourceRows: [], references: [] }].sort((a, b) => a.date.localeCompare(b.date));
    session.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days, dates: days.map(day => day.date), uniqueReferences: [...new Set(days.flatMap(day => day.references))] });
    session.setSelectedReadingDate(today);

    const renderer = await mount();
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onBookChange('GEN'); });
    await act(async () => { await reader.props.onChapterChange('1'); });
    await pressTodayTabFromPoints();
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('GEN.1');
    const tabPressRevision = session.getReadingSessionSnapshot().todayReaderTabPressRevision;

    await act(async () => { session.setReadingPlan({ ...calendar.canonicalSeptemberPlan, days, dates: days.map(day => day.date), uniqueReferences: [] }); await Promise.resolve(); });
    expect(session.getReadingSessionSnapshot().todayReaderTabPressRevision).toBe(tabPressRevision);
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('GEN.1');
    await act(async () => { renderer.unmount(); });
  });

  it('keeps FREE_BROWSE GEN.1 after YouVersion and Diary return without a Today-entry reset', async () => {
    const renderer = await mount();
    const session = await import('../../src/ui/readingSession');
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onBookChange('GEN'); });
    await act(async () => { await reader.props.onChapterChange('1'); });
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('GEN.1');

    await act(async () => {
      (readerLayout(renderer).props.onOpenYouVersion as (() => void) | undefined)?.();
      await Promise.resolve();
    });
    await act(async () => { renderer.update(React.createElement(ReaderScreen)); await Promise.resolve(); });
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('GEN.1');
    expect(await savedRow()).toMatchObject({ mode: 'FREE_BROWSE', reference: 'GEN.1' });

    const beforeDiaryReturn = session.getReadingSessionSnapshot().todayReaderTabPressRevision;
    navigationState.pathname = '/journal';
    await act(async () => { renderer.update(React.createElement(ReaderScreen)); await Promise.resolve(); });
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('GEN.1');

    let tabsRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { tabsRenderer = TestRenderer.create(React.createElement(TabsLayout)); });
    const tabs = tabsRenderer.root.findAll((node: Node) => String(node.type) === 'Tabs')[0];
    const listeners = tabs.props.screenListeners as (input: { route: { name: string } }) => { tabPress?: (event: { defaultPrevented: boolean; preventDefault?: () => void }) => void };
    const returnToReader = { defaultPrevented: false, preventDefault: vi.fn() };
    act(() => listeners({ route: { name: 'today' } }).tabPress!(returnToReader));
    expect(returnToReader.preventDefault).toHaveBeenCalledOnce();
    await act(async () => { tabsRenderer.unmount(); });
    navigationState.pathname = '/reader';
    await act(async () => { renderer.update(React.createElement(ReaderScreen)); await Promise.resolve(); });
    expect(`${bibleReader(renderer).props.book}.${bibleReader(renderer).props.chapter}`).toBe('GEN.1');
    expect(await savedRow()).toMatchObject({ mode: 'FREE_BROWSE', reference: 'GEN.1' });
    expect(session.getReadingSessionSnapshot().todayReaderTabPressRevision).toBe(beforeDiaryReturn);
    expect(recorded.audioPlayCalls).toBe(0);
    expect(recorded.completionWrites).toBe(0);
    await act(async () => { renderer.unmount(); });
  });

  it('does not turn a date arrow into a Reader tab reset, autoplay or completion', async () => {
    const session = await import('../../src/ui/readingSession');
    const renderer = await mount();
    const tabPressRevision = session.getReadingSessionSnapshot().todayReaderTabPressRevision;
    const nextDate = readerLayout(renderer).props.nextDate as string;
    expect(nextDate).toBeTruthy();

    pressByLabel(renderer, '下一個排定讀經日');
    await act(async () => { await Promise.resolve(); });

    expect(session.getReadingSessionSnapshot()).toMatchObject({ selectedDate: nextDate, todayReaderTabPressRevision: tabPressRevision });
    expect(recorded.audioPlayCalls).toBe(0);
    expect(recorded.completionWrites).toBe(0);
    await act(async () => { renderer.unmount(); });
  });

  it('starts on the FIRST assigned passage', async () => {
    const renderer = await mount();
    expect(lastRequest()).toEqual({ versionId: 46, usfm: 'JHN.19' });
    expect(renderer.root.findAll(n => n.props.accessibilityLabel === '更多閱讀工具' && isReachable(renderer, n)).length).toBeGreaterThan(0);
    await act(async () => { renderer.unmount(); });
  });

  // FALSIFICATION OF THE CURRENT CALLER. With chapterUsfm={model.reader.references[0]} this asks for
  // JHN.19 forever, so this test fails until the selection is really wired.
  it('follows the SECOND assigned passage when the reader picks it', async () => {
    const renderer = await mount();
    selectAssigned(renderer, '約20');
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()).toEqual({ versionId: 46, usfm: 'JHN.20' });
    expect(audioChapter(renderer)).toContain('約20');
    await act(async () => { renderer.unmount(); });
  });

  it('advances to the NEXT assigned passage through persistent daily buttons', async () => {
    const renderer = await mount();
    pressByLabel(renderer, '選擇今日章節清單');
    const entries = renderer.root.findAll((n: Node) => String(n.type) === 'Pressable'
      && String(n.props.accessibilityLabel).startsWith('前往') && isReachable(renderer, n));
    expect(entries.map((n: Node) => n.props.accessibilityLabel)).toEqual(['前往約19', '前往約20']);
    pressByLabel(renderer, '前往約20');
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('JHN.20');
    await act(async () => { renderer.unmount(); });
  });

  it('follows a FREE choice of GEN.1 made through the official reader, which is not in the day plan', async () => {
    const renderer = await mount();
    openMore(renderer);
    pressByLabel(renderer, '選擇其他章節');
    const picker = renderer.root.findAll((n: Node) => String(n.type) === 'OfficialChapterPicker')[0];
    expect(isReachable(renderer, picker)).toBe(true);
    await act(async () => { picker.props.onSelect({ book: 'GEN', chapter: '1', versionId: 46 }); });
    expect(renderer.root.findAll((n: Node) => String(n.type) === 'OfficialChapterPicker')[0].props.isOpen).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()).toEqual({ versionId: 46, usfm: 'GEN.1' });
    expect(readerLayout(renderer).props.selectionSource).toBe('FREE');
    const controlRow = renderer.root.findAll((node: Node) => node.props?.accessibilityLabel === '讀經控制列')[0];
    expect(controlRow.findAll((node: Node) => String(node.type) === 'Text').map((node: Node) => String(node.props.children)).join(' ')).toContain('自由閱讀');
    await act(async () => { renderer.unmount(); });
  });

  it('does not splice an OLD book onto a NEW chapter across a batched book+chapter change', async () => {
    const renderer = await mount();
    const reader = bibleReader(renderer);
    // both callbacks fire from one navigation, before a re-render can refresh either closure
    await act(async () => {
      await reader.props.onBookChange('PSA');
      await reader.props.onChapterChange('90');
    });
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('PSA.90');
    expect(lastRequest()?.usfm).not.toBe('JHN.90');
    await act(async () => { renderer.unmount(); });
  });

  it('carries a version change through to the audio request', async () => {
    const renderer = await mount();
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onBookChange('PSA'); });
    await act(async () => { await reader.props.onChapterChange('88'); });
    openMore(renderer);
    pressByLabel(renderer, '選擇譯本');
    const { getYouVersionVersionOptions } = await import('../../src/config/youVersionContent');
    const label = getYouVersionVersionOptions().find(option => option.versionId === 40)!.translationName;
    await act(async () => { pressByLabel(renderer, label); });
    expect(renderer.root.findAll((n: Node) => String(n.type) === 'Modal' && n.props.visible)).toHaveLength(0);
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()).toEqual({ versionId: 40, usfm: 'PSA.88' });
    await act(async () => { renderer.unmount(); });
  });

  it('returns to the assigned range and the audio follows, without changing the day\'s task', async () => {
    const renderer = await mount();
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onBookChange('GEN'); });
    await act(async () => { await reader.props.onChapterChange('1'); });
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('GEN.1');

    selectAssigned(renderer, '約19');
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('JHN.19');
    await act(async () => { renderer.unmount(); });
  });

  it('keeps the reader surface and the audio label naming the SAME chapter', async () => {
    const renderer = await mount();
    selectAssigned(renderer, '約20');
    await act(async () => { await Promise.resolve(); });
    const reader = bibleReader(renderer);
    const shown = `${reader.props.book ?? reader.props.defaultBook}.${reader.props.chapter ?? reader.props.defaultChapter}`;
    expect(shown).toBe('JHN.20');
    expect(lastRequest()?.usfm).toBe('JHN.20');
    await act(async () => { renderer.unmount(); });
  });
});

describe('the OLD caller really was broken, and this suite detects it (120 falsification)', () => {
  // Reproduces the exact shipped composition: the real child components, but the audio given
  // references[0] the way app/(tabs)/reader.tsx did before this fix. This reproducer stays green;
  // the real ReaderScreen positive cases above are what fail if that old wiring is reinstated.
  it('leaves the audio on the FIRST passage when the reader picks the second', async () => {
    const { YouVersionReader } = await import('../../src/ui/YouVersionReader');
    const { ChapterAudioControls } = await import('../../src/ui/ChapterAudioControls');
    const references = ['JHN.19', 'JHN.20'];

    const LegacyReader = () => React.createElement(
      'LegacyRoot',
      null,
      React.createElement(YouVersionReader, {
        date: '2026-09-12', references, appKey: 'test-app-key', versionId: 46,
        allowTechnicalProbe: true, allowedVersionIds: [46], fullscreen: false,
      }),
      // THE OLD WIRING: always the first assigned passage
      React.createElement(ChapterAudioControls, { chapterUsfm: references[0], versionId: 46 }),
    );

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(LegacyReader)); });
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('JHN.19');

    pressByLabel(renderer, '選擇約20');
    await act(async () => { await Promise.resolve(); });

    // the reader moved, the audio did not - this is the defect 120 rejected
    expect(lastRequest()?.usfm).toBe('JHN.19');
    await act(async () => { renderer.unmount(); });
  });
});

describe('119 protections still hold through the real wiring (120 oracle 5)', () => {
  it('ends on the LAST selection after a fast A -> B -> A switch', async () => {
    const renderer = await mount();
    selectAssigned(renderer, '約20');
    selectAssigned(renderer, '約19');
    selectAssigned(renderer, '約20');
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('JHN.20');
    await act(async () => { renderer.unmount(); });
  });

  it('cancels the in-flight request when the reader leaves the page', async () => {
    const renderer = await mount();
    const before = recorded.cancels;
    // unmount must run inside act so React actually flushes the effect cleanups
    await act(async () => { renderer.unmount(); });
    expect(recorded.cancels).toBeGreaterThan(before);
  });

  it('asks again for each distinct selection rather than reusing the first answer', async () => {
    const renderer = await mount();
    selectAssigned(renderer, '約20');
    await act(async () => { await Promise.resolve(); });
    const asked = recorded.requests.map((r) => r.usfm);
    expect(asked).toContain('JHN.19');
    expect(asked).toContain('JHN.20');
    await act(async () => { renderer.unmount(); });
  });
});

async function savedRow(): Promise<Record<string, unknown> | undefined> {
  const db = await import('../../src/storage/mobileDatabase');
  return (db.openQingmuReaderPositionStore() as unknown as { __saved: () => Record<string, unknown> | undefined }).__saved();
}

describe('C4 — what gets PERSISTED must match what was selected, not the pre-batch closure', () => {
  it('persists GEN.1 at version 40 when book, chapter and version all change in ONE batch', async () => {
    const renderer = await mount();
    const reader = bibleReader(renderer);
    await act(async () => {
      await reader.props.onBookChange('GEN');
      await reader.props.onChapterChange('1');
      await reader.props.onVersionChange(40);
    });
    await act(async () => { await Promise.resolve(); });

    // the immediate request was already right before this fix; the SAVED row was not
    expect(lastRequest()).toEqual({ versionId: 40, usfm: 'GEN.1' });
    const row = await savedRow();
    expect(row?.book).toBe('GEN');
    expect(row?.chapter).toBe('1');
    expect(row?.versionId).toBe(40);
    expect(row?.reference).toBe('GEN.1');
    await act(async () => { renderer.unmount(); });
  });

  it('restores GEN.1 / 40 after a remount, which is where the stale save used to show up', async () => {
    const first = await mount();
    const reader = bibleReader(first);
    await act(async () => {
      await reader.props.onBookChange('GEN');
      await reader.props.onChapterChange('1');
      await reader.props.onVersionChange(40);
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { first.unmount(); });

    recorded.requests.length = 0;
    const second = await mount();
    expect(lastRequest()).toEqual({ versionId: 40, usfm: 'GEN.1' });
    const shown = bibleReader(second);
    expect(`${shown.props.book}.${shown.props.chapter}`).toBe('GEN.1');
    await act(async () => { second.unmount(); });
  });

  it('a version change with no browsing still persists the chapter actually on screen', async () => {
    const renderer = await mount();
    selectAssigned(renderer, '約20');
    await act(async () => { await Promise.resolve(); });
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onVersionChange(40); });
    await act(async () => { await Promise.resolve(); });
    const row = await savedRow();
    expect(`${row?.book}.${row?.chapter}`).toBe('JHN.20');
    expect(row?.versionId).toBe(40);
    await act(async () => { renderer.unmount(); });
  });
});

describe('C5 — changing the reading date moves reader AND audio to that day\'s passages', () => {
  it('starts on the current day plan', async () => {
    const renderer = await mount();
    expect(lastRequest()?.usfm).toBe('JHN.19');
    await act(async () => { renderer.unmount(); });
  });

  it('follows the Home date store to a day with DIFFERENT assigned passages', async () => {
    const renderer = await mount();
    await selectDateInReader(renderer, '2026-09-03');
    await act(async () => { await Promise.resolve(); });

    expect(lastRequest()?.usfm).toBe('PSA.88');
    const shown = bibleReader(renderer);
    expect(`${shown.props.book ?? shown.props.defaultBook}.${shown.props.chapter ?? shown.props.defaultChapter}`).toBe('PSA.88');
    await act(async () => { renderer.unmount(); });
  });

  it('still follows the second passage of the NEW date', async () => {
    const renderer = await mount();
    await selectDateInReader(renderer, '2026-09-03');
    await act(async () => { await Promise.resolve(); });
    selectAssigned(renderer, '詩89');
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('PSA.89');
    await act(async () => { renderer.unmount(); });
  });

  it('does not carry the previous date\'s free-browse position onto the new date', async () => {
    const renderer = await mount();
    const reader = bibleReader(renderer);
    await act(async () => { await reader.props.onBookChange('GEN'); await reader.props.onChapterChange('1'); });
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('GEN.1');

    await selectDateInReader(renderer, '2026-09-03');
    await act(async () => { await Promise.resolve(); });
    expect(lastRequest()?.usfm).toBe('PSA.88');
    await act(async () => { renderer.unmount(); });
  });
});

describe('account preference integration at the REAL Reader caller', () => {
  const storedPreferences = (owner: string) => [...preferenceIO.data.values()].map(value => JSON.parse(value)).find(record => record.owner === owner)?.preferences;
  async function changeAccount(renderer: TestRenderer.ReactTestRenderer, memberId: string | null) {
    readerAuth.memberId = memberId; readerAuth.epoch++;
    await act(async () => { renderer.update(React.createElement(ReaderScreen)); });
  }

  it('persists version independently of positions and restores before SDK/audio mount', async () => {
    readerAuth.memberId = 'A';
    const first = await mount();
    await act(async () => { await bibleReader(first).props.onVersionChange(40); });
    expect(storedPreferences('A')?.versionId).toBe(40);
    await act(async () => { first.unmount(); });
    const db = await import('../../src/storage/mobileDatabase');
    (db.openQingmuReaderPositionStore() as unknown as { __reset(): void }).__reset();
    recorded.requests.length = 0;
    const second = await mount();
    expect(bibleReader(second).props.versionId).toBe(40);
    expect(recorded.requests.length).toBeGreaterThan(0);
    expect(recorded.requests.every(request => request.versionId === 40)).toBe(true);
    await act(async () => { second.unmount(); });
  });

  it('does not restore a date-specific position version over the account preference', async () => {
    readerAuth.memberId = 'A';
    const renderer = await mount();
    await act(async () => { await bibleReader(renderer).props.onVersionChange(40); });
    const db = await import('../../src/storage/mobileDatabase');
    db.openQingmuReaderPositionStore().save({ memberId: 'A', planId: 'church-2026-09', taskDate: '2026-09-03', versionId: 46, book: 'PSA', chapter: '88', reference: 'PSA.88', mode: 'FREE_BROWSE', updatedAt: 'test' });
    await selectDateInReader(renderer, '2026-09-03');
    expect(bibleReader(renderer).props.versionId).toBe(40);
    expect(lastRequest()).toEqual({ versionId: 40, usfm: 'PSA.88' });
    selectAssigned(renderer, '詩89');
    expect(bibleReader(renderer).props.versionId).toBe(40);
    await act(async () => { renderer.unmount(); });
  });

  it('does not preload scripture/audio before a delayed preference read and still provides account access', async () => {
    readerAuth.memberId = 'A';
    let release!: (value: string | null) => void;
    preferenceIO.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const renderer = await mount();
    expect(renderer.root.findAll(n => String(n.type) === 'BibleReader')).toHaveLength(0);
    expect(recorded.requests).toHaveLength(0);
    expect(renderer.root.findAll(n => n.props.accessibilityLabel === '開啟帳戶' && typeof n.props.onPress === 'function').length).toBeGreaterThan(0);
    await act(async () => { release(JSON.stringify({ schemaVersion: 1, owner: 'A', preferences: { versionId: 40, settings: null } })); });
    expect(bibleReader(renderer).props.versionId).toBe(40);
    expect(recorded.requests.every(request => request.versionId === 40)).toBe(true);
    await act(async () => { renderer.unmount(); });
  });

  it('ignores old-account book/chapter/version callbacks after switching to another account', async () => {
    readerAuth.memberId = 'A';
    const renderer = await mount();
    const old = bibleReader(renderer).props;
    await changeAccount(renderer, 'B');
    const current = bibleReader(renderer).props;
    await act(async () => { current.onBookChange('PSA'); current.onChapterChange('88'); });
    const writes = preferenceIO.set.mock.calls.length;
    await act(async () => { old.onBookChange('GEN'); old.onChapterChange('1'); old.onVersionChange(40); });
    expect(bibleReader(renderer).props.book).toBe('PSA');
    expect(bibleReader(renderer).props.chapter).toBe('88');
    expect(bibleReader(renderer).props.versionId).toBe(46);
    expect(preferenceIO.set).toHaveBeenCalledTimes(writes);
    expect((await savedRow())?.memberId).toBe('B');
    await act(async () => { renderer.unmount(); });
  });

  it('persists font changes delivered by the patched SDK subscription', async () => {
    readerAuth.memberId = 'A';
    const renderer = await mount();
    await act(async () => {
      readerSettings.value = { fontSize: 28, fontFamily: 'Inter', lineSpacing: 2 };
      readerSettings.listeners.forEach(listener => listener({ ...readerSettings.value }));
    });
    expect(storedPreferences('A')?.settings).toEqual({ fontSize: 28, fontFamily: 'Inter', lineSpacing: 2 });
    await act(async () => { renderer.unmount(); });
    const restored = await mount();
    expect(readerSettings.value).toEqual({ fontSize: 28, fontFamily: 'Inter', lineSpacing: 2 });
    await act(async () => { restored.unmount(); });
  });

  it('shows save failure and retries the newest preference through the native adapter', async () => {
    readerAuth.memberId = 'A';
    const renderer = await mount();
    preferenceIO.set.mockRejectedValueOnce(new Error('PRIVATE_IO_DETAIL'));
    await act(async () => { await bibleReader(renderer).props.onVersionChange(40); });
    expect(preferenceIO.alerts.length).toBeGreaterThan(0);
    expect(JSON.stringify(preferenceIO.alerts)).not.toContain('PRIVATE_IO_DETAIL');
    const retry = preferenceIO.alerts.at(-1)?.buttons?.find(button => button.text?.includes('重試'));
    expect(retry?.onPress).toBeDefined();
    await act(async () => { retry!.onPress!(); });
    expect(storedPreferences('A')?.versionId).toBe(40);
    await act(async () => { renderer.unmount(); });
  });

  it('lets a guest choose a version without disk writes', async () => {
    process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false';
    const renderer = await mount();
    await act(async () => { await bibleReader(renderer).props.onVersionChange(40); });
    expect(bibleReader(renderer).props.versionId).toBe(40);
    expect(preferenceIO.get).not.toHaveBeenCalled();
    expect(preferenceIO.set).not.toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });

  it('keeps the REAL More version page open on SecureStore failure and closes only after a successful retry', async () => {
    readerAuth.memberId = 'A';
    const renderer = await mount();
    const { getYouVersionVersionOptions } = await import('../../src/config/youVersionContent');
    const label = getYouVersionVersionOptions().find(option => option.versionId === 40)!.translationName;
    openMore(renderer); pressByLabel(renderer, '選擇譯本');
    preferenceIO.set.mockRejectedValueOnce(new Error('PRIVATE_MORE_STORAGE_ERROR'));
    await act(async () => { pressByLabel(renderer, label); });
    expect(renderer.root.findAll(n => n.props.accessibilityLabel === '關閉譯本選擇' && isReachable(renderer, n)).length).toBeGreaterThan(0);
    const text = renderer.root.findAll(n => String(n.type) === 'Text').map(n => String(n.props.children)).join(' ');
    expect(text).toContain('譯本未儲存，請再試一次。');
    expect(text).not.toContain('PRIVATE_MORE_STORAGE_ERROR');
    expect(preferenceIO.alerts).toHaveLength(0);
    expect(storedPreferences('A')).toBeUndefined();
    await act(async () => { pressByLabel(renderer, label); });
    expect(storedPreferences('A')?.versionId).toBe(40);
    expect(renderer.root.findAll(n => String(n.type) === 'Modal' && n.props.visible)).toHaveLength(0);
    expect(preferenceIO.alerts).toHaveLength(0);
    // A later SDK font failure still belongs to the Alert/retry path, not More's inline owner.
    preferenceIO.set.mockRejectedValueOnce(new Error('PRIVATE_FONT_STORAGE_ERROR'));
    await act(async () => {
      readerSettings.value = { fontSize: 28, fontFamily: 'Inter', lineSpacing: 2 };
      readerSettings.listeners.forEach(listener => listener({ ...readerSettings.value }));
    });
    expect(preferenceIO.alerts).toHaveLength(1);
    expect(JSON.stringify(preferenceIO.alerts)).not.toContain('PRIVATE_FONT_STORAGE_ERROR');
    const retryFont = preferenceIO.alerts[0].buttons?.find(button => button.text?.includes('重試'));
    expect(retryFont?.onPress).toBeDefined();
    await act(async () => { retryFont!.onPress!(); });
    expect(storedPreferences('A')?.settings.fontSize).toBe(28);
    await act(async () => { renderer.unmount(); });
  });

  it('does not let a late More save from A close the newly opened B version page', async () => {
    readerAuth.memberId = 'A';
    const renderer = await mount();
    const { getYouVersionVersionOptions } = await import('../../src/config/youVersionContent');
    const label = getYouVersionVersionOptions().find(option => option.versionId === 40)!.translationName;
    let finish!: () => void;
    preferenceIO.set.mockImplementationOnce((key, value) => new Promise<void>(resolve => {
      finish = () => { preferenceIO.data.set(key, value); resolve(); };
    }));
    openMore(renderer); pressByLabel(renderer, '選擇譯本');
    await act(async () => { pressByLabel(renderer, label); });
    expect(finish).toBeDefined();
    await changeAccount(renderer, 'B');
    // The previous menu unmounted at the owner gate. Open B's own page through its visible More UI.
    if (renderer.root.findAll(n => n.props.accessibilityLabel === '關閉更多閱讀工具' && isReachable(renderer, n)).length === 0) openMore(renderer);
    pressByLabel(renderer, '選擇譯本');
    await act(async () => { finish(); });
    expect(renderer.root.findAll(n => n.props.accessibilityLabel === '關閉譯本選擇' && isReachable(renderer, n)).length).toBeGreaterThan(0);
    expect(bibleReader(renderer).props.versionId).toBe(46);
    expect(storedPreferences('B')).toBeUndefined();
    expect(preferenceIO.alerts).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
  });
});
