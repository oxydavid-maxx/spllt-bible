import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ foreground: new Set<() => void>() }));
vi.hoisted(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('../../src/services/appVisibility', () => ({ subscribeAppActive: (fn: () => void) => { native.foreground.add(fn); return () => native.foreground.delete(fn); } }));
let tree: TestRenderer.ReactTestRenderer | null = null;
afterEach(() => { act(() => tree?.unmount()); tree = null; vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup(now = '2026-10-19T15:59:00Z') {
  vi.resetModules(); vi.stubEnv('EXPO_PUBLIC_QINGMU_TEST_DATE', ''); vi.useFakeTimers(); vi.setSystemTime(new Date(now));
  const session = await import('../../src/ui/readingSession');
  let visible = true, playing = false, finished = false, devotionPlaying = false, devotionFinished = true;
  function Screen() { const snapshot = (session.useReadingSession as any)({ visible, playing, finished, devotionPlaying, devotionFinished }); return React.createElement('Date', { date: snapshot.selectedDate }); }
  await act(async () => { tree = TestRenderer.create(React.createElement(Screen)); });
  return { session, date: () => tree!.root.findByType('Date' as never).props.date, render: async (v: boolean, p = false, f = false, dp = false, df = true) => { visible = v; playing = p; finished = f; devotionPlaying = dp; devotionFinished = df; await act(async () => tree!.update(React.createElement(Screen))); } };
}
it('moves the automatic date after Taipei midnight on foreground, without any midnight timer (5)', async () => {
  const h = await setup(); expect(h.date()).toBe('2026-10-19');
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(h.date()).toBe('2026-10-19'); expect(vi.getTimerCount()).toBe(0);
  await act(async () => native.foreground.forEach(fn => fn()));
  expect(h.date()).toBe('2026-10-20');
});
it('checks the date when the reader becomes visible, preserving a manually chosen history day (5)', async () => {
  const h = await setup(); await h.render(false); vi.setSystemTime(new Date('2026-10-19T16:01:00Z'));
  await h.render(true); expect(h.date()).toBe('2026-10-20');
  act(() => h.session.setSelectedReadingDate('2026-10-17'));
  vi.setSystemTime(new Date('2026-10-20T16:01:00Z'));
  await act(async () => native.foreground.forEach(fn => fn())); expect(h.date()).toBe('2026-10-17');
});
it('keeps an ongoing narration across midnight and pause, then moves only after it finishes (5)', async () => {
  const h = await setup(); await h.render(true, true);
  vi.setSystemTime(new Date('2026-10-19T16:01:00Z'));
  await act(async () => native.foreground.forEach(fn => fn())); expect(h.date()).toBe('2026-10-19');
  await h.render(true, false, false); expect(h.date()).toBe('2026-10-19');
  await h.render(true, false, true); expect(h.date()).toBe('2026-10-20');
});


it('moves to the actual new Taipei day after the bundled plan ends, so new remote dates can be read (5)', async () => {
  const h = await setup('2026-12-31T15:59:00Z'); expect(h.date()).toBe('2026-12-31');
  vi.setSystemTime(new Date('2026-12-31T16:01:00Z'));
  await act(async () => native.foreground.forEach(fn => fn()));
  expect(h.date()).toBe('2027-01-01');
});


it('keeps a speaking or paused devotion across midnight and changes the date only after it finishes (5)', async () => {
  const h = await setup(); await h.render(true, false, true, true, false);
  vi.setSystemTime(new Date('2026-10-19T16:01:00Z'));
  await act(async () => native.foreground.forEach(fn => fn())); expect(h.date()).toBe('2026-10-19');
  await h.render(true, false, true, false, false); expect(h.date()).toBe('2026-10-19');
  await h.render(true, false, true, false, true); expect(h.date()).toBe('2026-10-20');
});
