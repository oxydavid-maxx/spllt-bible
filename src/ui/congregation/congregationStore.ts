import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { subscribeAppActive } from '../../services/appVisibility';
import { runtimeConfig } from '../../config/runtime';
import { useAuthSnapshot } from '../../services/authSession';
import { createDevotionClient, type Congregation } from '../../services/devotionClient';

/**
 * Where the signed-in member belongs (青少/主堂, 維護者 2026-10-17), shared by the first-run choice, the account
 * page and the announcements tab. Read on entry and foreground; a failed read is retried the next time a screen asks.
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
const listeners = new Set<() => void>();
const publish = (next: CongregationSnapshot) => { snapshot = Object.freeze(next); listeners.forEach((listener) => listener()); };

/** For tests: forget the member. */
export function resetCongregationStore(): void { generation++; pendingKey = null; saving = false; snapshot = IDLE; listeners.forEach((listener) => listener()); }

type Client = Pick<ReturnType<typeof createDevotionClient>, 'getCongregation' | 'setCongregation'>;

function load(key: string, client: Client, refresh = false, visibleRevision = 0): void {
  if ((pendingKey === key && (saving || pendingRevision === visibleRevision)) || (snapshot.key === key && !refresh && snapshot.status === 'ready')) return;
  const request = ++generation; pendingKey = key; pendingRevision = visibleRevision;
  if (snapshot.key !== key || snapshot.status !== 'ready') publish({ key, status: 'loading', value: snapshot.key === key ? snapshot.value : null });
  // Any failure, even a client that cannot ask, reads as not known yet: no screen waits on this.
  void Promise.resolve().then(() => client.getCongregation())
    .then((value) => { if (snapshot.key === key && generation === request) publish({ key, status: 'ready', value }); })
    .catch(() => { if (snapshot.key === key && generation === request) publish({ key, status: 'error', value: snapshot.value }); })
    .finally(() => { if (generation === request) pendingKey = null; });
}

export interface CongregationBinding extends CongregationSnapshot {
  /** Saves the choice; rejects when it was not saved, leaving the old value in place. */
  choose(value: Congregation): Promise<void>;
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
    if (!key || !client) return;
    load(key, client);
    return subscribeAppActive(revision => load(key, client, true, revision));
  }, [key, client]);
  const mine = key && current.key === key ? current : { ...IDLE, key };
  return {
    ...mine,
    async choose(value) {
      if (!key || !client) throw new Error('NOT_SIGNED_IN');
      const request = ++generation; pendingKey = key; saving = true;
      try {
        const saved = await client.setCongregation(value);
        if (snapshot.key === key && generation === request) publish({ key, status: 'ready', value: saved });
      } finally { if (generation === request) { pendingKey = null; saving = false; } }
    },
  };
}
