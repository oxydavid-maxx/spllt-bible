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

  it('does not persist the same draft twice when an explicit flush is followed by a date change', () => {
    const save = vi.spyOn(store, 'save');
    const hook = mountHook('2026-09-12');
    act(() => { hook.view().setBody('先保存一次'); });
    act(() => { hook.view().flushNow(); });
    hook.setDate('2026-09-13');
    expect(save).toHaveBeenCalledOnce();
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

  it('copies each save to the mirror, after the local store already has it', () => {
    const mirrored: Array<[string, string]> = [];
    const seen: { view: ReturnType<typeof useJournalEntry> | null } = { view: null };
    function Probe() {
      seen.view = useJournalEntry({
        memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-12',
        newOperationId: () => `op-${++ids}`, openStore: () => store,
        mirror: (taskDate, body) => { mirrored.push([taskDate, body]); },
      });
      return null;
    }
    act(() => { create(React.createElement(Probe)); });
    act(() => { seen.view!.setBody('寫給自己看的'); });
    act(() => { vi.advanceTimersByTime(2_000); });

    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })?.body).toBe('寫給自己看的');
    expect(mirrored).toEqual([['2026-09-12', '寫給自己看的']]);
  });

  // The mirror is a copy of something already saved. If copying it out could lose it, adding the
  // feature would have made the journal less trustworthy than it was without it.
  it('keeps the entry when the mirror throws', () => {
    const seen: { view: ReturnType<typeof useJournalEntry> | null } = { view: null };
    function Probe() {
      seen.view = useJournalEntry({
        memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-12',
        newOperationId: () => `op-${++ids}`, openStore: () => store,
        mirror: () => { throw new Error('folder went away'); },
      });
      return null;
    }
    act(() => { create(React.createElement(Probe)); });
    act(() => { seen.view!.setBody('資料夾壞掉也不能掉字'); });
    act(() => { vi.advanceTimersByTime(2_000); });

    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })?.body).toBe('資料夾壞掉也不能掉字');
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

// 光佑 2026-09-26: "日記寫完要可以按儲存，以及儲存成功。不然寫完有點不知所措". Saving already happened
// two seconds after typing stopped, but nothing on screen said so. The hook now reports it.
describe('the journal tells the member whether their writing is saved', () => {
  it('has nothing to report on an empty day', () => {
    expect(mountHook('2026-09-12').view().saveStatus).toBe('empty');
  });

  it('reports unsaved while typing and saved, with the time, once the Save button is pressed', () => {
    vi.setSystemTime(new Date('2026-09-26T00:58:00.000Z'));
    const hook = mountHook('2026-09-26');
    act(() => { hook.view().setBody('今天讀到多 2 章'); });
    expect(hook.view().saveStatus).toBe('unsaved');

    act(() => { hook.view().saveNow(); });

    expect(hook.view().saveStatus).toBe('saved');
    expect(hook.view().savedAt).toBe('2026-09-26T00:58:00.000Z');
    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-26' })?.body).toBe('今天讀到多 2 章');
  });

  it('also reports saved when the automatic save got there first', () => {
    const hook = mountHook('2026-09-26');
    act(() => { hook.view().setBody('忘了按儲存'); });
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(hook.view().saveStatus).toBe('saved');
  });

  it('shows a day written earlier as saved, at the time it was written', () => {
    store.save({ memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-25', body: '昨天寫的', operationId: 'seed', expectedRevision: 0 }, '2026-09-25T12:30:00.000Z');
    const hook = mountHook('2026-09-25');
    expect(hook.view().saveStatus).toBe('saved');
    expect(hook.view().savedAt).toBe('2026-09-25T12:30:00.000Z');
  });
});
