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
const recorded = vi.hoisted(() => ({ requests: [] as { versionId: number; usfm: string }[], cancels: 0 }));
const preferenceIO = vi.hoisted(() => {
  const data = new Map<string, string>();
  return { data, get: vi.fn(async (key: string) => data.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
    alerts: [] as Array<{ title: string; message?: string; buttons?: Array<{ text?: string; onPress?: () => void }> }> };
});
const readerAuth = vi.hoisted(() => ({ memberId: null as string | null, epoch: 0 }));
const readerSettings = vi.hoisted(() => ({ value: { fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 },
  listeners: new Set<(next: { fontSize: number; fontFamily: string; lineSpacing: number }) => void>() }));

vi.mock('expo-router', () => ({
  router: { replace: vi.fn() },
  // Exercise the real focus effect bodies, including cleanup; only navigation's native boundary is doubled.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const R = require('react') as typeof React;
    R.useEffect(effect, [effect]);
  },
}));
vi.mock('expo-status-bar', () => ({ StatusBar: primitive('StatusBar') }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: Object.assign(primitive('NavigationBar'), { setHidden: vi.fn() }) }));
vi.mock('expo-audio', () => ({
  useAudioPlayer: () => {
    const R = require('react') as typeof React;
    // The real hook holds one instance across renders. Remain inert: this lane proves selection only.
    const ref = R.useRef<object | null>(null);
    if (!ref.current) ref.current = {
      play: () => undefined, pause: () => undefined, replace: () => undefined,
      addListener: () => ({ remove: () => undefined }),
      seekTo: async () => undefined, setPlaybackRate: () => undefined, remove: () => undefined,
      currentTime: 0, duration: 0, playing: false, isLoaded: false, isBuffering: false,
    };
    return ref.current;
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixture-operation') }));
vi.mock('expo-secure-store', () => ({ getItemAsync: (key: string) => preferenceIO.get(key), setItemAsync: (key: string, value: string) => preferenceIO.set(key, value) }));
vi.mock('react-native', () => ({
  ActivityIndicator: primitive('ActivityIndicator'),
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
  Linking: { openURL: vi.fn() },
}));
vi.mock('../../src/ui/AccountEntryButton', () => ({ AccountEntryButton: () => React.createElement('AccountEntryButton') }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView'), useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('../../src/ui/completionFeedback', () => ({ CompletionFeedback: () => React.createElement('CompletionFeedback') }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => ({ session: readerAuth.memberId ? { memberId: readerAuth.memberId, sessionToken: 'memory-session' } : null, epoch: readerAuth.epoch }) }));
vi.mock('../../src/services/reminderScheduler', () => ({ createReminderScheduler: () => ({}) }));
vi.mock('../../src/services/reminderCompletion', () => ({ syncReadingReminderForCompletion: vi.fn() }));
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
    openQingmuRepository: vi.fn(() => ({ get: vi.fn(() => undefined), flush: vi.fn(async () => []) })),
    openQingmuReaderPositionStore: vi.fn(() => store),
    openQingmuJournalStore: vi.fn(() => ({ get: () => null, save: (command: Record<string, unknown>) => command })),
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
            validUntil: null,
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
  pressByLabel(renderer, `前往${referenceLabel}`);
  expect(renderer.root.findAll((n: Node) => String(n.type) === 'Modal' && n.props.visible)).toHaveLength(0);
}

async function selectDateFromHome(date: string): Promise<void> {
  // Date selection moved to Home. Exercise the shared store the real Reader subscribes to.
  const { setSelectedReadingDate } = await import('../../src/ui/readingSession');
  await act(async () => { setSelectedReadingDate(date); });
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

// FILE-level reset. A describe-scoped beforeEach left later suites reading the previous suite's saved
// position and reading date, which is test pollution rather than product behaviour.
beforeEach(async () => {
  process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'true';
  readerAuth.memberId = null; readerAuth.epoch = 0;
  preferenceIO.data.clear(); preferenceIO.alerts.length = 0;
  preferenceIO.get.mockReset().mockImplementation(async key => preferenceIO.data.get(key) ?? null);
  preferenceIO.set.mockReset().mockImplementation(async (key, value) => { preferenceIO.data.set(key, value); });
  readerSettings.value = { fontSize: 20, fontFamily: 'Inter', lineSpacing: 1.8 }; readerSettings.listeners.clear();
  recorded.requests.length = 0;
  recorded.cancels = 0;
  const db = await import('../../src/storage/mobileDatabase');
  (db.openQingmuReaderPositionStore() as unknown as { __reset: () => void }).__reset();
  const rs = await import('../../src/ui/readingSession');
  rs.setSelectedReadingDate(BASE_DATE);
});

describe('the chapter the audio asks for follows the ACTUAL reader selection (120 R1)', () => {
  const originalError = console.error;
  const env = { ...process.env };
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      const m = String(args[0] ?? '');
      if (m.includes('react-test-renderer is deprecated') || m.includes('testing environment is not configured to support act')) return;
      originalError(...args);
    };
  });
  afterAll(() => { console.error = originalError; process.env = env; });

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
    await selectDateFromHome('2026-09-03');
    await act(async () => { await Promise.resolve(); });

    expect(lastRequest()?.usfm).toBe('PSA.88');
    const shown = bibleReader(renderer);
    expect(`${shown.props.book ?? shown.props.defaultBook}.${shown.props.chapter ?? shown.props.defaultChapter}`).toBe('PSA.88');
    await act(async () => { renderer.unmount(); });
  });

  it('still follows the second passage of the NEW date', async () => {
    const renderer = await mount();
    await selectDateFromHome('2026-09-03');
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

    await selectDateFromHome('2026-09-03');
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
    await selectDateFromHome('2026-09-03');
    expect(bibleReader(renderer).props.versionId).toBe(40);
    expect(lastRequest()).toEqual({ versionId: 40, usfm: 'PSA.88' });
    selectAssigned(renderer, '詩89');
    expect(bibleReader(renderer).props.versionId).toBe(40);
    await act(async () => { renderer.unmount(); });
  });

  it('does not preload scripture/audio before a delayed preference read and still provides Back', async () => {
    readerAuth.memberId = 'A';
    let release!: (value: string | null) => void;
    preferenceIO.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const renderer = await mount();
    expect(renderer.root.findAll(n => String(n.type) === 'BibleReader')).toHaveLength(0);
    expect(recorded.requests).toHaveLength(0);
    expect(renderer.root.findAll(n => n.props.accessibilityLabel === '返回今日' && typeof n.props.onPress === 'function').length).toBeGreaterThan(0);
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
