import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  values: new Map<string, string>(), speak: vi.fn(), setDevotion: vi.fn(async () => undefined),
  post: { date: '2026-10-14', weekday: '三', passages: '詩118', title: '測試題目', sections: [{ heading: '默想經文', paragraphs: ['測試段落'] }], song: { youtubeId: 'abcdefghijk' } },
}));
vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('expo-speech', () => ({ speak: native.speak, stop: async () => undefined }));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => native.values.get(k) ?? null, setItemAsync: async (k: string, v: string) => { native.values.set(k, v); } }));
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => ({ getDevotionDates: async () => [], setDevotion: native.setDevotion, getDevotional: async () => native.post }) }));
vi.mock('../../src/ui/devotion/DevotionalView', () => ({ DevotionalView: (p: any) => React.createElement('DevotionalView', p) }));
import { useReaderDevotion, type ReaderDevotionBinding } from '../../src/ui/devotion/useReaderDevotion';
let binding: ReaderDevotionBinding; let view: TestRenderer.ReactTestRenderer;
async function mount(memberId: string, textSettings?: { fontSize: number; lineSpacing: number } | null) {
  function Harness() { binding = useReaderDevotion({ session: { memberId, sessionToken: 'synthetic-token' }, date: '2026-10-14', baseUrl: 'https://fixture.test', showTools: vi.fn(), textSettings }); return null; }
  await act(async () => { view = TestRenderer.create(React.createElement(Harness)); });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T04:00:00Z')); native.speak.mockClear(); });
afterEach(() => { act(() => view?.unmount()); vi.useRealTimers(); });
it('expires an already visible untouched offer at the seventh Taipei midnight (#6)', async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-10-20T15:59:59Z'));
  const key = 'qingmu.devotion.follow.v1.m-' + Array.from('clock-test', c => c.codePointAt(0)!.toString(16)).join('_');
  native.values.set(key, JSON.stringify({ enabled: false, touched: false, firstOfferedOn: '2026-10-14' }));
  await mount('clock-test');
  expect(binding.devotion?.followOfferEligible).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => { vi.advanceTimersByTime(1001); });
  expect(new Date().toISOString()).toBe('2026-10-20T16:00:00.001Z');
  expect(binding.devotion?.followOfferEligible).toBe(false);
  await act(async () => binding.devotion!.onFollow());
  expect(binding.devotion?.followEnabled).toBe(false); expect(binding.devotion?.selected).toBe(false);
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
it('explicit offer enables and opens without playing; subsequent narration EOF follows (#6/#10)', async () => {
  await mount('offer-test');
  act(() => binding.devotion!.onFollowOfferShown!());
  await act(async () => binding.devotion!.onFollow());
  expect(binding.devotion?.selected).toBe(true); expect(binding.devotion?.followEnabled).toBe(true);
  expect(binding.devotion?.followOfferEligible).toBe(false); expect(native.speak).not.toHaveBeenCalled();
  act(() => binding.leave());
  await act(async () => binding.onLastChapterNarrated());
  expect(binding.devotion?.selected).toBe(true); expect(native.speak).toHaveBeenCalled();
  act(() => binding.devotion!.onFollowChange(false));
  act(() => binding.leave()); act(() => binding.onLastChapterNarrated());
  expect(binding.devotion?.selected).toBe(false); expect(binding.devotion?.followOfferEligible).toBe(false);
});
