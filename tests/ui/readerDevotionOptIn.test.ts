import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  values: new Map<string, string>(), speak: vi.fn(), setDevotion: vi.fn(async () => undefined),
  post: { date: '2026-10-14', weekday: '三', passages: '詩118', title: '測試題目', sections: [{ heading: '默想經文', paragraphs: ['測試段落'] }], song: { youtubeId: 'abcdefghijk' } },
}));
vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('expo-speech', () => ({ speak: native.speak, stop: async () => undefined }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => native.values.get(k) ?? null, setItemAsync: async (k: string, v: string) => { native.values.set(k, v); } }));
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => ({ getDevotionDates: async () => [], setDevotion: native.setDevotion, getDevotional: async () => native.post }) }));
vi.mock('../../src/ui/devotion/DevotionalView', () => ({ DevotionalView: (p: any) => React.createElement('DevotionalView', p) }));
import { useReaderDevotion, type ReaderDevotionBinding } from '../../src/ui/devotion/useReaderDevotion';
let binding: ReaderDevotionBinding; let view: TestRenderer.ReactTestRenderer;
async function mount(memberId: string) {
  function Harness() { binding = useReaderDevotion({ session: { memberId, sessionToken: 'synthetic-token' }, date: '2026-10-14', baseUrl: 'https://fixture.test', showTools: vi.fn() }); return null; }
  await act(async () => { view = TestRenderer.create(React.createElement(Harness)); });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T04:00:00Z')); native.speak.mockClear(); });
afterEach(() => { act(() => view?.unmount()); vi.useRealTimers(); });
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
