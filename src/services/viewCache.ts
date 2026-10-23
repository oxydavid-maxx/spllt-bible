import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as authSession from './authSession';
import type { AuthSession } from './authSession';

/**
 * One shared way for every switch that used to wait on the network (光佑 2026-10-23:「速度要完全無感非常的快」):
 * 全教會｜青少, a change of month, 主堂獎品｜青少獎品, 自己｜好友, 我的領取紀錄, 公告的主堂, the reader's 靈修.
 *
 * - A tap shows what is kept here at once; the backend is asked again in the background and the screen changes only
 *   when the answer differs.
 * - A page opening asks ahead for what a tap can reach next (the other side, the months either side).
 * - Within one visit (`freshSince`, from `beginVisit()` when the page was opened) the same question is never sent twice:
 *   an answer from this visit, or one still on its way, is used as it is. A visit later, it is shown and asked again.
 *   Visits are counted, not timed, so two visits in the same millisecond (or under a frozen test clock) stay apart.
 * - A failed ask keeps what is kept (no network: the last answer stays on screen). With nothing kept, the caller shows
 *   the error it showed before.
 * - Every key starts with the member and session (`viewCacheKey`), and any change of member or session — sign-out,
 *   another account, an expired or revoked session — empties the store, so nobody sees another person's data.
 * - Memory only, at most MAX_ENTRIES answers (the oldest go first): a few kilobytes each, nothing is written to disk.
 */

export const MAX_ENTRIES = 64;
/** `freshSince` for an ask that must go out now, even with one on its way (each opening of 選擇目標獎品, a pushed new friend). */
export const ASK_AGAIN = Number.POSITIVE_INFINITY;

export interface ReadOptions { reuseValue?: boolean; joinAnyInflight?: boolean }

interface Entry { value?: unknown; fetchedAt: number; failed: boolean; failure?: { reason: unknown; at: number }; inflight?: { promise: Promise<unknown>; startedAt: number } }

export interface ViewCache {
  peek<T>(key: string): T | undefined;
  /** The last ask failed and nothing is kept: the caller's error state. */
  failed(key: string): boolean;
  /** Why and when the last ask failed, while nothing is kept and no ask is on its way. */
  failure(key: string): { reason: unknown; at: number } | undefined;
  /**
   * The kept answer if it is from this visit; otherwise the one ask on its way, or a new one. `reuseValue: false` asks
   * even with an answer from this visit (asking again at a look); `joinAnyInflight` waits for an ask on its way however
   * old (one question at a time, as the reader's 靈修 has always asked).
   */
  read<T>(key: string, load: () => Promise<T>, freshSince?: number, options?: ReadOptions): Promise<T>;
  /** A kept answer that came in this visit. */
  fresh(key: string, since: number): boolean;
  /** The ask on its way is forgotten: its answer is not kept (the question belonged to a day the reader left). */
  dropInflight(key: string): void;
  /** The same as read, for content a tap may reach next; its failure is kept quietly. */
  prefetch<T>(key: string, load: () => Promise<T>, freshSince?: number, options?: ReadOptions): void;
  /** Changes kept answers in place (a 靈修 mark set on this phone), for keys whose parts match. */
  update<T>(match: (parts: unknown[]) => boolean, change: (value: T) => T): void;
  /** Kept answers stay on screen but are asked again at the next read (a completion confirmed meanwhile). */
  invalidate(match: (parts: unknown[]) => boolean): void;
  clear(): void;
  /** Starts a visit: answers from before it are shown but asked again. */
  beginVisit(): number;
  subscribe(listener: () => void): () => void;
  version(): number;
}

function partsOf(key: string): unknown[] { try { const parts = JSON.parse(key); return Array.isArray(parts) ? parts : []; } catch { return []; } }

export function createViewCache(options: { maxEntries?: number } = {}): ViewCache {
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  let visits = 0;
  let visitOpen = false;
  const now = () => visits;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let generation = 0;
  let revision = 0;
  let owner: string | null = null;
  const publish = () => { revision += 1; for (const listener of [...listeners]) listener(); };
  const touch = (key: string, entry: Entry) => {
    entries.delete(key); entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = [...entries].find(([, item]) => !item.inflight)?.[0] ?? entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };
  const read = <T>(key: string, load: () => Promise<T>, freshSince = 0, options: ReadOptions = {}): Promise<T> => {
    // A question for another member or session empties the store first, whatever the sign-in events said.
    const asker = JSON.stringify(partsOf(key).slice(0, 2));
    if (owner !== null && owner !== asker) clear();
    owner = asker;
    const entry = entries.get(key);
    if (entry?.inflight && (options.joinAnyInflight || entry.inflight.startedAt >= freshSince)) return entry.inflight.promise as Promise<T>;
    if (options.reuseValue !== false && entry && 'value' in entry && !entry.failed && entry.fetchedAt >= freshSince) return Promise.resolve(entry.value as T);
    const asked = generation;
    const startedAt = now();
    // Called now, not a tick later: the answer lands in the same turn a direct call's would.
    let promise: Promise<T>;
    try { promise = Promise.resolve(load()); } catch (reason) { promise = Promise.reject(reason); }
    const next: Entry = { ...(entry ?? { fetchedAt: 0 }), failed: false, failure: undefined, inflight: { promise, startedAt } };
    touch(key, next);
    promise.then((value) => {
      if (asked !== generation || entries.get(key)?.inflight?.promise !== promise) return;
      const kept = entries.get(key)!;
      // Same answer as before: keep the old object, so nothing on screen re-renders for it.
      const same = 'value' in kept && JSON.stringify(kept.value) === JSON.stringify(value);
      touch(key, { value: same ? kept.value : value, fetchedAt: now(), failed: false });
      publish();
    }, (reason: unknown) => {
      if (asked !== generation || entries.get(key)?.inflight?.promise !== promise) return;
      const kept = entries.get(key)!;
      touch(key, 'value' in kept ? { value: kept.value, fetchedAt: kept.fetchedAt, failed: false } : { fetchedAt: kept.fetchedAt, failed: true, failure: { reason, at: now() } });
      publish();
    });
    return promise;
  };
  function clear(): void { generation += 1; entries.clear(); owner = null; publish(); }
  return {
    peek: <T>(key: string) => entries.get(key)?.value as T | undefined,
    failed: (key) => Boolean(entries.get(key)?.failed),
    failure: (key) => entries.get(key)?.failure,
    fresh: (key, since) => { const entry = entries.get(key); return Boolean(entry && 'value' in entry && entry.fetchedAt >= since); },
    dropInflight: (key) => { const entry = entries.get(key); if (entry?.inflight) delete entry.inflight; },
    read,
    prefetch: (key, load, freshSince, options) => { void read(key, load, freshSince, options).catch(() => undefined); },
    update: <T>(match: (parts: unknown[]) => boolean, change: (value: T) => T) => {
      let changed = false;
      for (const [key, entry] of entries) if ('value' in entry && match(partsOf(key))) { entry.value = change(entry.value as T); changed = true; }
      if (changed) publish();
    },
    invalidate: (match) => { for (const [key, entry] of entries) if (match(partsOf(key))) { entry.fetchedAt = 0; if (entry.inflight) entry.inflight.startedAt = 0; } },
    clear,
    // Calls in the same turn are one visit: one return to the app can reach a screen through two signals at once.
    beginVisit: () => {
      if (!visitOpen) { visits += 1; visitOpen = true; void Promise.resolve().then(() => { visitOpen = false; }); }
      return visits;
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => revision,
  };
}

/** The App's one store. Emptied whenever the member or session changes. */
export const viewCache = createViewCache();
try {
  authSession.registerAuthLifecycleListener((change) => {
    const { previous, current } = change;
    if (!previous || !current || previous.memberId !== current.memberId || previous.sessionToken !== current.sessionToken) viewCache.clear();
  });
} catch {
  // A stand-in authSession without sign-in events (screen tests): the member check in read() still keeps members apart.
}

/** Keys always lead with whose data it is. */
export function viewCacheKey(session: Pick<AuthSession, 'memberId' | 'sessionToken'>, ...parts: Array<string | number>): string {
  return JSON.stringify([session.memberId, session.sessionToken, ...parts]);
}

export interface ViewCacheRequest<T> { key: string; load: () => Promise<T> }

/**
 * What `key` shows now, straight from the store in the same render as the tap. While `active`, asks for `key` and the
 * `ahead` keys once per visit (`freshSince`); `retry` asks again for a failed key.
 */
export function useViewCache<T>(request: ViewCacheRequest<T> | null, options: { active: boolean; freshSince: number; ahead?: Array<ViewCacheRequest<unknown>>; retry?: number; cache?: ViewCache }): { value: T | undefined; failed: boolean } {
  const cache = options.cache ?? viewCache;
  useSyncExternalStore(cache.subscribe, cache.version, cache.version);
  const latest = useRef({ request, ahead: options.ahead });
  latest.current = { request, ahead: options.ahead };
  const key = request?.key ?? null;
  const aheadKeys = (options.ahead ?? []).map((item) => item.key).join('\n');
  useEffect(() => {
    if (!options.active) return;
    const current = latest.current;
    if (current.request) void cache.read(current.request.key, current.request.load, options.freshSince).catch(() => undefined);
    for (const item of current.ahead ?? []) cache.prefetch(item.key, item.load, options.freshSince);
  }, [cache, key, aheadKeys, options.active, options.freshSince, options.retry]);
  return { value: key ? cache.peek<T>(key) : undefined, failed: key ? cache.failed(key) : false };
}

/** 靈修 marks for one calendar range. The 積分 calendar and the reader ask with the same ranges, so they share them. */
export function devotionDatesKey(session: Pick<AuthSession, 'memberId' | 'sessionToken'>, from: string, to: string): string {
  return viewCacheKey(session, 'devotion-dates', from, to);
}
const coversDate = (session: Pick<AuthSession, 'memberId' | 'sessionToken'>, kind: string, date: string) => (parts: unknown[]) =>
  parts[0] === session.memberId && parts[1] === session.sessionToken && parts[2] === kind && typeof parts[3] === 'string' && typeof parts[4] === 'string' && date >= parts[3] && date <= parts[4];
/** A 靈修 mark set or taken back on this phone shows in every kept range at once. */
export function markDevotionInViewCache(session: Pick<AuthSession, 'memberId' | 'sessionToken'>, date: string, completed: boolean): void {
  viewCache.update<string[]>(coversDate(session, 'devotion-dates', date), (dates) => completed ? [...new Set([...dates, date])] : dates.filter((value) => value !== date));
}
/** A completion confirmed for `date`: kept reading days that cover it are asked again before they are used. */
export function invalidateReadingDaysInViewCache(session: Pick<AuthSession, 'memberId' | 'sessionToken'>, date: string): void {
  viewCache.invalidate(coversDate(session, 'reading-days', date));
}
