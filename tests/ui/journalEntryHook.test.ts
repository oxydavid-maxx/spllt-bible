import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { DatabaseSync } from 'node:sqlite';
import { createJournalStore } from '../../src/storage/journalStore';
import type { MobileDatabase } from '../../src/storage/mobileRepository';

vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuJournalStore: () => { throw new Error('the test must inject a store'); } }));

import { useJournalEntry } from '../../src/ui/useJournalEntry';

// The failure this feature cannot survive is losing a day's writing. These tests drive the hook
// against a real in-memory database and reproduce the two ways it could happen: a debounce that
// never fires because the member navigated away, and a stale load landing on a day they have since
// moved to.

function deviceDatabase(): MobileDatabase {
  const db = new DatabaseSync(':memory:');
  return {
    execSync: (source) => db.exec(source),
    runSync: (source, ...params) => db.prepare(source).run(...(params as never[])),
    getFirstSync: <T,>(source: string, ...params: unknown[]) => (db.prepare(source).get(...(params as never[])) ?? null) as T | null,
    getAllSync: <T,>(source: string, ...params: unknown[]) => db.prepare(source).all(...(params as never[])) as T[],
  };
}

let store: ReturnType<typeof createJournalStore>;
let ids = 0;

beforeEach(() => { store = createJournalStore(deviceDatabase()); ids = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Renders the hook and exposes its latest view, the way a panel would consume it. */
function mountHook(initialDate: string) {
  const seen: { view: ReturnType<typeof useJournalEntry> | null } = { view: null };
  function Probe({ taskDate }: { taskDate: string }) {
    seen.view = useJournalEntry({
      memberId: 'member-self',
      planId: 'church-2026-09',
      taskDate,
      newOperationId: () => `op-${++ids}`,
      openStore: () => store,
    });
    return null;
  }
  let renderer: ReturnType<typeof create>;
  act(() => { renderer = create(React.createElement(Probe, { taskDate: initialDate })); });
  return {
    view: () => seen.view!,
    setDate: (taskDate: string) => act(() => { renderer.update(React.createElement(Probe, { taskDate })); }),
    unmount: () => act(() => { renderer.unmount(); }),
  };
}

describe('a day of writing survives every way it could be dropped', () => {
  it('keeps text typed and then left before the debounce fired', () => {
    const hook = mountHook('2026-09-12');
    act(() => { hook.view().setBody('還沒到兩秒就換頁了'); });

    hook.setDate('2026-09-13'); // leaves before the timer fires

    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })?.body).toBe('還沒到兩秒就換頁了');
  });

  it('shows the right day after going away and coming back', () => {
    const hook = mountHook('2026-09-12');
    act(() => { hook.view().setBody('第一天寫的'); });
    hook.setDate('2026-09-13');
    expect(hook.view().body).toBe('');

    act(() => { hook.view().setBody('第二天寫的'); });
    hook.setDate('2026-09-12');
    expect(hook.view().body).toBe('第一天寫的');

    hook.setDate('2026-09-13');
    expect(hook.view().body).toBe('第二天寫的');
  });

  it('keeps text typed and then closed, without waiting for the debounce', () => {
    const hook = mountHook('2026-09-12');
    act(() => { hook.view().setBody('關掉面板就走'); });
    hook.unmount();

    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })?.body).toBe('關掉面板就走');
  });

  it('saves on its own once the member stops typing', () => {
    const hook = mountHook('2026-09-12');
    act(() => { hook.view().setBody('停下來兩秒'); });
    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })).toBeNull();

    act(() => { vi.advanceTimersByTime(2_000); });
    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })?.body).toBe('停下來兩秒');
  });

  it('puts a copied verse on its own line without eating what was already written', () => {
    const hook = mountHook('2026-09-12');
    act(() => { hook.view().setBody('我的想法'); });
    act(() => { hook.view().appendQuote('「神賜給我們的不是膽怯的心」提後 1:7'); });

    expect(hook.view().body).toBe('我的想法\n「神賜給我們的不是膽怯的心」提後 1:7\n');
  });

  it('reports a conflict so the panel can offer to save anyway, and never blanks the text', async () => {
    vi.useRealTimers();
    store.save({ memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-12', body: '這台寫的', operationId: 'seed', expectedRevision: 0 });
    // The flush has been told another device already wrote this day.
    await store.flush(async () => ({ ok: false, outcome: 'CONFLICT', revision: 3 }), 'member-self');
    vi.useFakeTimers();

    const hook = mountHook('2026-09-12');
    expect(hook.view().body).toBe('這台寫的');
    expect(hook.view().conflict).toBe(true);
  });
});
