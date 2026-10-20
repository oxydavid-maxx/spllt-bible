import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { subscribeAppActive } from '../../services/appVisibility';
import { runtimeConfig } from '../../config/runtime';
import { useAuthSnapshot } from '../../services/authSession';
import { createDevotionClient, type Congregation } from '../../services/devotionClient';
import { recallCongregation, rememberCongregation } from './congregationMemory';

/**
 * Where the signed-in member belongs (青少/主堂, 維護者 2026-10-17), shared by the first-run choice, the account
 * page, the 積分 page and the announcements tab. Read on entry and foreground; a failed read is retried the next
 * time a screen asks. A failed read falls back to what this phone last saw of the member (維護者 2026-10-20), so
 * `status: 'error'` can still carry a value; with nothing seen, the value stays null and the member is asked.
 */
export interface CongregationSnapshot {
  key: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: Congregation | null;
}

const IDLE: CongregationSnapshot = Object.freeze({ key: null, status: 'idle', value: null });
let snapshot: CongregationSnapshot = IDLE;
let generation = 0;
let pendingKey: string | null = null;
let pendingRevision = 0;
let saving = false;
let retries = 0;
const listeners = new Set<() => void>();
const publish = (next: CongregationSnapshot) => { snapshot = Object.freeze(next); listeners.forEach((listener) => listener()); };
// A read that timed out or found no network is asked again twice, 2 s and then 5 s later, before it counts as
// failed: a failed read asks a member this phone has never seen, and a fresh install's first answer can take longer
// than the 8 s deadline (00-smoke, run 39182073666). Bounded, never a poll.
const RETRY_DELAYS_MS = [2000, 5000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const retryable = (reason: unknown) => typeof reason === 'object' && reason !== null && (reason as { retryable?: unknown }).retryable === true;

/** For tests: forget the member (this phone's memory of them stays, like a restarted app). */
export function resetCongregationStore(): void {
  generation++; pendingKey = null; saving = false; snapshot = IDLE;
  if (retryTimer) clearTimeout(retryTimer); retryTimer = null;
  listeners.forEach((listener) => listener());
}

type Client = Pick<ReturnType<typeof createDevotionClient>, 'getCongregation' | 'setCongregation'>;

function load(key: string, memberId: string, client: Client, refresh = false, visibleRevision = 0, attempt = 0): void {
  if ((pendingKey === key && (saving || pendingRevision === visibleRevision)) || (snapshot.key === key && !refresh && snapshot.status === 'ready')) return;
  if (retryTimer) clearTimeout(retryTimer); retryTimer = null;
  const request = ++generation; pendingKey = key; pendingRevision = visibleRevision;
  if (snapshot.key !== key || snapshot.status !== 'ready') publish({ key, status: 'loading', value: snapshot.key === key ? snapshot.value : null });
  // Any failure, even a client that cannot ask, reads as not known yet: no screen waits on this.
  void Promise.resolve().then(() => client.getCongregation())
    .then((value) => {
      if (snapshot.key !== key || generation !== request) return;
      publish({ key, status: 'ready', value });
      void rememberCongregation(memberId, value);
    })
    .catch(async (reason: unknown) => {
      if (snapshot.key !== key || generation !== request) return;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined && retryable(reason)) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (snapshot.key === key && generation === request) load(key, memberId, client, true, visibleRevision, attempt + 1);
        }, delay);
        return;
      }
      const remembered = snapshot.value ?? await recallCongregation(memberId);
      if (snapshot.key === key && generation === request) publish({ key, status: 'error', value: snapshot.value ?? remembered });
    })
    .finally(() => { if (generation === request) pendingKey = null; });
}

export interface CongregationBinding extends CongregationSnapshot {
  /** Saves the choice; rejects when it was not saved, leaving the old value in place. */
  choose(value: Congregation): Promise<void>;
  /** Reads again now (「再試一次」 on the first choice). */
  retry(): void;
}

export function useCongregation(): CongregationBinding {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const key = session ? `${session.memberId}:${session.sessionToken}` : null;
  const client = useMemo<Client | null>(() => session ? createDevotionClient({
    baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl,
    token: session.sessionToken, memberId: session.memberId,
  }) : null, [session?.memberId, session?.sessionToken]);
  const current = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => snapshot, () => snapshot,
  );
  useEffect(() => {
    if (!key || !client || !session) return;
    load(key, session.memberId, client);
    return subscribeAppActive(revision => load(key, session.memberId, client, true, revision));
  }, [key, client]);
  const mine = key && current.key === key ? current : { ...IDLE, key };
  return {
    ...mine,
    async choose(value) {
      if (!key || !client || !session) throw new Error('NOT_SIGNED_IN');
      const request = ++generation; pendingKey = key; saving = true;
      try {
        const saved = await client.setCongregation(value);
        if (snapshot.key === key && generation === request) publish({ key, status: 'ready', value: saved });
        void rememberCongregation(session.memberId, saved);
      } finally { if (generation === request) { pendingKey = null; saving = false; } }
    },
    retry() {
      // Its own revision, so a retry is never mistaken for the read already on its way. The member pressed it, so
      // no automatic re-reads: the answer (or the failure) shows at once.
      if (key && client && session) load(key, session.memberId, client, true, -(++retries), RETRY_DELAYS_MS.length);
    },
  };
}
