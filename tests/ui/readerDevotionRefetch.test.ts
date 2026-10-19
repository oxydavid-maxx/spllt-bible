import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 2026-10-19 (維護者): 傳道每天不一定什麼時候上傳, so 還沒有上傳 is asked again at the next look: the 靈修 chip,
// arriving at the last chapter's end, or the app coming back. These tests mount the real reader layout with the
// real 靈修 hook (only the network and native modules are stand-ins), because the 2026-10-19 review found a loop
// that only shows when the layout's chapter-end effect and the hook run together.
const native = vi.hoisted(() => ({
  listeners: new Set<(state: string) => void>(),
  focus: null as null | (() => void), blur: null as null | (() => void),
  values: new Map<string, string>(),
  speak: vi.fn(),
  getDevotional: vi.fn(async (_date: string): Promise<unknown> => null),
  post: { date: '2026-10-14', weekday: '三', passages: '詩118', title: '測試題目', sections: [{ heading: '默想經文', paragraphs: ['測試段落'] }], song: { youtubeId: 'abcdefghijk', title: null } },
}));
vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('react-native', () => ({
  TextInput: 'TextInput', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Modal: (props: any) => props.visible ? React.createElement('Modal', props, props.children) : null,
  StyleSheet: { create: (value: unknown) => value },
  Appearance: { getColorScheme: () => 'light' }, useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 393, fontScale: 1 }),
  Linking: { openURL: async () => undefined },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  AppState: { currentState: 'active', addEventListener: (_: string, fn: (s: string) => void) => { native.listeners.add(fn); return { remove: () => native.listeners.delete(fn) }; } },
}));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline'), Path: el('Path'), Rect: el('Rect'), G: el('G'), Line: el('Line'), Text: el('SvgText') }; });
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: () => React.createElement('MaterialCommunityIcons') }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: Object.assign(() => null, { setHidden: () => undefined }) }));
// The reader tab's focus, as expo-router reports it: focus() on (re)entering the tab, blur() on leaving it.
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => {
  React.useEffect(() => {
    const focus = () => { native.blur = callback() || null; };
    native.focus = focus; focus();
    return () => { native.blur?.(); native.focus = null; native.blur = null; };
  }, [callback]);
} }));
vi.mock('../../src/ui/ChapterAudioControls', () => ({
  ChapterAudioAutoplayNotice: () => null, ChapterAudioAutoplayToggle: () => null,
  ChapterAudioControls: React.forwardRef((_props: any, ref: any) => { React.useImperativeHandle(ref, () => ({ pause: async () => undefined })); return null; }),
}));
vi.mock('expo-speech', () => ({ speak: native.speak, stop: async () => undefined }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => native.values.get(k) ?? null, setItemAsync: async (k: string, v: string) => { native.values.set(k, v); } }));
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => ({ getDevotionDates: async () => [], setDevotion: async () => undefined, getDevotional: native.getDevotional }) }));
vi.mock('../../src/ui/devotion/DevotionalView', () => ({ DevotionalView: (p: any) => React.createElement('DevotionalView', p) }));

import { FullscreenReaderLayout, useReaderChrome } from '../../src/ui/FullscreenReaderLayout';
import { useReaderDevotion, type ReaderDevotionBinding } from '../../src/ui/devotion/useReaderDevotion';

let chrome: ReturnType<typeof useReaderChrome>;
let binding: ReaderDevotionBinding;
let renderer: TestRenderer.ReactTestRenderer | null = null;
let date = '2026-10-14';
const controls = { ready: true, openChapterPicker: () => undefined, openVersionPicker: () => undefined, openSettings: () => undefined };
function Reader() {
  chrome = useReaderChrome();
  binding = useReaderDevotion({ session: { memberId: 'refetch-test', sessionToken: 'synthetic-token' }, baseUrl: 'https://fixture.test', date, showTools: chrome.showTools, focused: chrome.focused });
  // The day's last chapter (詩91 of 詩90–91), as app/(tabs)/reader.tsx wires it.
  return React.createElement(FullscreenReaderLayout, {
    reader: React.createElement('BibleReader'), controls, chrome, chapterUsfm: 'PSA.91', versionId: 139,
    references: ['PSA.90', 'PSA.91'], selectionSource: 'ASSIGNED', activeReferenceIndex: 1,
    onSelectReference: () => binding.leave(), selectedDate: date, onSelectDate: () => undefined, devotion: binding.devotion,
    metadata: { translationName: '測試譯本', publisher: '測試出版社', copyrightNotice: '測試版權文字', officialUrl: 'https://example.test/version' },
  });
}
async function mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(Reader)); }); }
async function showDate(next: string) { date = next; await act(async () => { renderer!.update(React.createElement(Reader)); }); }
const state = () => (binding.devotion!.renderView({ top: 0, bottom: 0 }) as React.ReactElement<{ state: { kind: string; awaiting?: boolean } }>).props.state;
const asked = () => native.getDevotional.mock.calls.length;
async function foreground() { await act(async () => { native.listeners.forEach(fn => fn('background')); native.listeners.forEach(fn => fn('active')); }); }
async function leaveReaderTab() { await act(async () => { native.blur?.(); native.blur = null; }); }
async function returnToReaderTab() { await act(async () => { native.focus?.(); }); }
async function reachLastChapterEnd() { await act(async () => { chrome.handleCanvasEdge({ atEnd: true }); }); }
async function leaveLastChapterEnd() { await act(async () => { chrome.handleCanvasEdge({ atEnd: false }); }); }
function pending() {
  let answer!: (value: unknown) => void; let fail!: (error: unknown) => void;
  native.getDevotional.mockImplementationOnce(() => new Promise((resolve, reject) => { answer = resolve; fail = reject; }));
  return { answer: async (value: unknown) => { await act(async () => answer(value)); }, fail: async () => { await act(async () => fail(new Error('offline'))); } };
}

beforeEach(() => {
  date = '2026-10-14';
  native.listeners.clear(); native.values.clear(); native.speak.mockClear();
  native.getDevotional.mockReset().mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { act(() => { renderer?.unmount(); }); renderer = null; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Blocker (review 1, 2, 6, 7, 11): every answer made a new `prepare`, and the layout asked again on each new one, so
// a member parked at the end of the day's last chapter sent one request per round trip, for 還沒有上傳 and for a
// failed load alike. Asking again happens on an event, never because the answer changed the state.
describe('parked at the end of the day\'s last chapter', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T00:30:00Z')); // 10/14 (三) 08:30 Taipei
    // A runaway loop is cut off here, so a failing run reports a count instead of hanging.
    native.getDevotional.mockImplementation(async () => { if (asked() > 40) return new Promise(() => undefined); return null; });
  });
  const parkTwoSeconds = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); };

  it('asks once while 靈修請待發佈 stays on, and once more only on a new arrival', async () => {
    await mount();
    expect(asked()).toBe(0);
    await reachLastChapterEnd();
    await parkTwoSeconds();
    expect(asked()).toBe(1);
    expect(state()).toEqual({ kind: 'missing', awaiting: true });
    await leaveLastChapterEnd(); await parkTwoSeconds();
    expect(asked()).toBe(1);
    await reachLastChapterEnd(); await parkTwoSeconds();
    expect(asked()).toBe(2);
  });

  it('asks once when the load fails, and leaves 重試 to the member', async () => {
    native.getDevotional.mockImplementation(async () => { if (asked() > 40) return new Promise(() => undefined); throw new Error('offline'); });
    await mount();
    await reachLastChapterEnd();
    await parkTwoSeconds();
    expect(asked()).toBe(1);
    expect(state().kind).toBe('error');
  });

  it('sends nothing while idle: no timer asks again', async () => {
    await mount();
    await reachLastChapterEnd();
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); });
    expect(asked()).toBe(1);
  });
});

describe('asking again after 還沒有上傳', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T00:30:00Z')); });

  it('asks again when the tab is opened again or the app comes back, without a spinner', async () => {
    await mount();
    await act(async () => binding.devotion!.onSelect());
    expect(state()).toEqual({ kind: 'missing', awaiting: true });
    const second = pending();
    await act(async () => binding.devotion!.onSelect());
    expect(asked()).toBe(2);
    expect(state()).toEqual({ kind: 'missing', awaiting: true });
    await second.answer(null);
    expect(state()).toEqual({ kind: 'missing', awaiting: true });
    native.getDevotional.mockResolvedValueOnce(native.post);
    await foreground();
    expect(asked()).toBe(3);
    expect(state().kind).toBe('ready');
    expect(binding.devotion?.available).toBe(true);
    // Fetched once it is there: no further look asks again.
    await act(async () => binding.devotion!.onSelect());
    await foreground();
    await reachLastChapterEnd();
    expect(asked()).toBe(3);
  });

  it('a failed quiet ask keeps 靈修請待發佈 on screen', async () => {
    await mount();
    await act(async () => binding.devotion!.onSelect());
    native.getDevotional.mockRejectedValueOnce(new Error('offline'));
    await foreground();
    expect(asked()).toBe(2);
    expect(state()).toEqual({ kind: 'missing', awaiting: true });
  });

  // Review 10, 14 (after #73): coming back is #73's useReaderRetrySignal, so the post follows the same rule as the
  // leaf: asked only while the reader is on screen, once per return to its tab or to the foreground.
  it('asks only while the reader is on screen: once per return to its tab or to the foreground', async () => {
    await mount();
    await act(async () => binding.devotion!.onSelect());
    expect(asked()).toBe(1);
    await leaveReaderTab();
    await foreground();
    expect(asked()).toBe(1);
    await returnToReaderTab();
    expect(asked()).toBe(2);
    await foreground();
    expect(asked()).toBe(3);
    expect(state()).toEqual({ kind: 'missing', awaiting: true });
  });

  // Minor (review 4): one question on its way at a time, so an older answer can never land after a newer one.
  it('keeps one question on its way: more looks while it is out send nothing more', async () => {
    await mount();
    await act(async () => binding.devotion!.onSelect());
    const out = pending();
    await foreground();
    expect(asked()).toBe(2);
    await act(async () => binding.devotion!.onSelect());
    await foreground();
    await reachLastChapterEnd();
    expect(asked()).toBe(2);
    await out.answer(native.post);
    expect(state().kind).toBe('ready');
  });

  it('an answer for a day left behind never replaces the newer answer', async () => {
    await mount();
    await act(async () => binding.devotion!.onSelect());
    const old = pending();
    await foreground();
    await showDate('2026-10-13');
    await showDate('2026-10-14');
    native.getDevotional.mockResolvedValueOnce(native.post);
    await act(async () => binding.devotion!.onSelect());
    expect(asked()).toBe(3);
    expect(state().kind).toBe('ready');
    await old.answer(null);
    expect(state().kind).toBe('ready');
  });
});

// Major (review 3, 8, 12): ▶ (or 接續靈修 handing over) on 靈修請待發佈 left a "read it once it comes" behind; hours
// later a foreground ask brought the post and the phone started reading aloud with no new tap. Only the answer to the
// question that was out when the member asked can start reading.
describe('▶ before the post is there', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T00:30:00Z')); });
  const reading = () => binding.devotion!.speaking || native.speak.mock.calls.length > 0;

  it('does not read aloud hours later when ▶ found nothing', async () => {
    await mount();
    await act(async () => binding.devotion!.onSelect());
    await act(async () => binding.devotion!.onPlayPause());
    expect(asked()).toBe(2);
    expect(reading()).toBe(false);
    vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
    native.getDevotional.mockResolvedValue(native.post);
    await foreground();
    expect(state().kind).toBe('ready');
    expect(reading()).toBe(false);
  });

  it('does not read aloud later when 接續靈修 handed over before the post was there', async () => {
    await mount();
    await act(async () => { await binding.devotion!.onFollowChange(true); });
    await act(async () => binding.onLastChapterNarrated());
    expect(binding.devotion?.selected).toBe(true);
    expect(state()).toEqual({ kind: 'missing', awaiting: true });
    native.getDevotional.mockResolvedValue(native.post);
    await foreground();
    expect(state().kind).toBe('ready');
    expect(reading()).toBe(false);
    act(() => binding.devotion!.onFollowChange(false));
  });

  it('does not read aloud later when the ▶ question failed', async () => {
    await mount();
    await act(async () => binding.devotion!.onSelect());
    native.getDevotional.mockRejectedValueOnce(new Error('offline'));
    await act(async () => binding.devotion!.onPlayPause());
    expect(state()).toEqual({ kind: 'missing', awaiting: true });
    native.getDevotional.mockResolvedValue(native.post);
    await foreground();
    expect(state().kind).toBe('ready');
    expect(reading()).toBe(false);
  });

  it('does not read aloud on a later look after ▶ met a load error', async () => {
    native.getDevotional.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    await mount();
    await act(async () => binding.devotion!.onSelect());
    await act(async () => binding.devotion!.onPlayPause());
    expect(asked()).toBe(2);
    expect(state().kind).toBe('error');
    native.getDevotional.mockResolvedValue(native.post);
    await act(async () => binding.devotion!.onSelect());
    expect(state().kind).toBe('ready');
    expect(reading()).toBe(false);
  });

  it('reads the post that the ▶ question itself brought', async () => {
    await mount();
    await act(async () => binding.devotion!.onSelect());
    const out = pending();
    await act(async () => binding.devotion!.onPlayPause());
    expect(reading()).toBe(false);
    await out.answer(native.post);
    expect(state().kind).toBe('ready');
    expect(binding.devotion!.speaking).toBe(true);
  });
});

// Minor (review 5, 9, 13): no 靈修 is posted on Sundays (the server answers a plain 404 then), so a Sunday never
// says 靈修請待發佈. Today and later Monday–Saturday still do; a past day says 這一天的靈修還沒有上傳.
describe('which empty day waits for a post', () => {
  it.each([
    ['today, a Sunday', '2026-10-18T02:00:00Z', '2026-10-18', false],
    ['today, a Monday', '2026-10-19T02:00:00Z', '2026-10-19', true],
    ['a later Saturday', '2026-10-19T02:00:00Z', '2026-10-24', true],
    ['a later Sunday', '2026-10-19T02:00:00Z', '2026-10-25', false],
    ['a past weekday', '2026-10-19T02:00:00Z', '2026-10-16', false],
  ] as const)('%s', async (_case, now, day, awaiting) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now));
    date = day;
    await mount();
    await act(async () => binding.devotion!.onSelect());
    expect(state()).toEqual({ kind: 'missing', awaiting });
  });
});
