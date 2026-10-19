import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  values: new Map<string, string>(), speak: vi.fn(), setDevotion: vi.fn(async () => undefined), getDevotionDates: vi.fn(async (): Promise<string[]> => []),
  post: { date: '2026-10-14', weekday: '三', passages: '詩118', title: '測試題目', sections: [{ heading: '默想經文', paragraphs: ['測試段落'] }], song: { youtubeId: 'abcdefghijk' } },
  getDevotional: vi.fn(async (_date: string): Promise<unknown> => null),
  appState: undefined as ((next: string) => void) | undefined,
}));
vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('expo-speech', () => ({ speak: native.speak, stop: async () => undefined }));
vi.mock('react-native', () => ({ AppState: { addEventListener: (_type: string, listener: (next: string) => void) => { native.appState = listener; return { remove() {} }; } } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => native.values.get(k) ?? null, setItemAsync: async (k: string, v: string) => { native.values.set(k, v); } }));
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => ({ getDevotionDates: native.getDevotionDates, setDevotion: native.setDevotion, getDevotional: native.getDevotional }) }));
vi.mock('../../src/ui/devotion/DevotionalView', () => ({ DevotionalView: (p: any) => React.createElement('DevotionalView', p) }));
import { useReaderDevotion, type ReaderDevotionBinding } from '../../src/ui/devotion/useReaderDevotion';
let binding: ReaderDevotionBinding; let view: TestRenderer.ReactTestRenderer;
async function mount(memberId: string, textSettings?: { fontSize: number; lineSpacing: number } | null) {
  function Harness() { binding = useReaderDevotion({ session: { memberId, sessionToken: 'synthetic-token' }, date: '2026-10-14', baseUrl: 'https://fixture.test', showTools: vi.fn(), textSettings, narrationSpeed: 1.5 }); return null; }
  await act(async () => { view = TestRenderer.create(React.createElement(Harness)); });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T04:00:00Z')); native.getDevotional.mockReset().mockResolvedValue(native.post); native.speak.mockClear(); native.setDevotion.mockClear(); native.getDevotionDates.mockReset().mockResolvedValue([]); vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));  });
afterEach(() => { act(() => view?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
// 2026-10-17 (維護者): reaching the last chapter's end asks for the day's post once, so 接著讀靈修 › only
// shows when there is a 靈修 to read; no timer, no offer window.
it('prepares the day’s post at the reading end and reports whether it exists', async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
  await mount('prepare-test');
  expect(vi.getTimerCount()).toBe(0);
  expect(binding.devotion?.available).toBe(false);
  await act(async () => binding.devotion!.prepare());
  expect(binding.devotion?.available).toBe(true);
  expect(binding.devotion?.selected).toBe(false); expect(native.speak).not.toHaveBeenCalled();
});
// 2026-10-19 (維護者): 傳道每天不一定什麼時候上傳. 還沒有上傳 is asked again at the next look instead of
// staying for the rest of the day; still no timer.
it('asks again after 還沒有上傳 when the tab is opened again or the app comes back, without a spinner', async () => {
  native.getDevotional.mockResolvedValue(null);
  await mount('late-post');
  const state = () => (binding.devotion!.renderView({ top: 0, bottom: 0 }) as React.ReactElement<{ state: { kind: string } }>).props.state;
  await act(async () => binding.devotion!.onSelect());
  expect(state()).toEqual({ kind: 'missing', awaiting: true });
  let answer!: (post: unknown) => void;
  native.getDevotional.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  await act(async () => binding.devotion!.onSelect());
  expect(native.getDevotional).toHaveBeenCalledTimes(2);
  expect(state()).toEqual({ kind: 'missing', awaiting: true });
  await act(async () => answer(null));
  expect(state()).toEqual({ kind: 'missing', awaiting: true });
  native.getDevotional.mockResolvedValueOnce(native.post);
  await act(async () => { native.appState?.('background'); native.appState?.('active'); });
  expect(native.getDevotional).toHaveBeenCalledTimes(3);
  expect(state().kind).toBe('ready');
  expect(binding.devotion?.available).toBe(true);
  await act(async () => { binding.devotion!.onSelect(); native.appState?.('active'); });
  expect(native.getDevotional).toHaveBeenCalledTimes(3);
});
it('hands the 靈修 page the reader\'s 調整字體 settings and whether it is being read aloud (光佑 2026-10-14)', async () => {
  await mount('text-test', { fontSize: 20, lineSpacing: 2 });
  await act(async () => binding.devotion!.onSelect());
  const page = () => (binding.devotion!.renderView({ top: 0, bottom: 0 }) as React.ReactElement<Record<string, unknown>>).props;
  expect(page()).toMatchObject({ fontSize: 20, lineSpacing: 2, speaking: false });
  await act(async () => binding.devotion!.onPlayPause());
  expect(native.speak).toHaveBeenCalled();
  expect(page()).toMatchObject({ speaking: true, activeIndex: 0 });
  act(() => binding.devotion!.onPlayPause());
  expect(page()).toMatchObject({ speaking: false, activeIndex: 0 });
});
it('ordinary leaf completion and manual tab selection never opt in or speak (#4/#7/#10)', async () => {
  await mount('manual-test');
  expect(binding.devotion?.followEnabled).toBe(false);
  await act(async () => binding.devotion!.onToggle());
  expect(native.setDevotion).toHaveBeenCalledWith('2026-10-14', true);
  act(() => binding.onLastChapterNarrated());
  expect(binding.devotion?.selected).toBe(false);
  await act(async () => binding.devotion!.onSelect());
  expect(binding.devotion?.followEnabled).toBe(false); expect(native.speak).not.toHaveBeenCalled();
});
it('the ⋯ menu switch turns auto-follow on and off; narration EOF follows only while it is on (#10)', async () => {
  await mount('menu-test');
  await act(async () => binding.devotion!.onFollowChange(true));
  expect(binding.devotion?.followEnabled).toBe(true); expect(binding.devotion?.selected).toBe(false);
  await act(async () => binding.onLastChapterNarrated());
  expect(binding.devotion?.selected).toBe(true); expect(native.speak).toHaveBeenCalled();
  act(() => binding.devotion!.onFollowChange(false));
  act(() => binding.leave()); act(() => binding.onLastChapterNarrated());
  expect(binding.devotion?.selected).toBe(false);
});

it('applies the common narration speed to device fallback and exposes a persisted voice choice', async () => {
  await mount('voice-test');
  expect(binding.devotion?.voice).toBe('zh-TW-YunJheNeural');
  await act(async () => binding.devotion!.onVoiceChange!('zh-TW-HsiaoChenNeural'));
  expect(binding.devotion?.voice).toBe('zh-TW-HsiaoChenNeural');
  expect([...native.values.values()]).toContain('zh-TW-HsiaoChenNeural');
  await act(async () => binding.devotion!.onSelect());
  await act(async () => binding.devotion!.onPlayPause());
  expect(native.speak).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ rate: 1.5, language: 'zh-TW' }));
});

it('produces completion feedback only after a successful mark, not undo or a failed request', async () => {
  await mount('completion-feedback');
  expect(binding.completionEvent).toBeNull();
  await act(async () => binding.devotion!.onToggle());
  expect(binding.completionEvent).toMatchObject({ kind: 'devotion', taskDate: '2026-10-14' });
  const id = binding.completionEvent!.operationId;
  act(() => binding.clearCompletionFeedback(id));
  await act(async () => binding.devotion!.onToggle());
  expect(binding.completionEvent).toBeNull();
  native.setDevotion.mockRejectedValueOnce(new Error('offline'));
  await act(async () => binding.devotion!.onToggle());
  expect(binding.completionEvent).toBeNull(); expect(binding.devotion?.completed).toBe(false);
});

it('a slow initial completion lookup cannot undo a newer successful leaf press', async () => {
  let resolve!: (dates: string[]) => void;
  native.getDevotionDates.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await mount('mark-race');
  await act(async () => binding.devotion!.onToggle());
  expect(binding.devotion?.completed).toBe(true);
  await act(async () => resolve([]));
  expect(binding.devotion?.completed).toBe(true);
});
it('two quick leaf presses produce only one pending mutation and one completion event', async () => {
  await mount('mark-double');
  await act(async () => { binding.devotion!.onToggle(); binding.devotion!.onToggle(); });
  expect(native.setDevotion).toHaveBeenCalledTimes(1);
  expect(binding.completionEvent?.operationId).toBe('devotion-1');
});
