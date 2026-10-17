import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { runtimeConfig } from '../../config/runtime';
import { useAuthSnapshot } from '../../services/authSession';
import { createDevotionClient, type Congregation } from '../../services/devotionClient';

/**
 * Where the signed-in member belongs (青少/主堂, 維護者 2026-10-17), shared by the first-run choice, the account
 * page and the announcements tab. Read once per session; a failed read is retried the next time a screen asks.
 */
export interface CongregationSnapshot {
  key: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: Congregation | null;
}

const IDLE: CongregationSnapshot = Object.freeze({ key: null, status: 'idle', value: null });
let snapshot: CongregationSnapshot = IDLE;
const listeners = new Set<() => void>();
const publish = (next: CongregationSnapshot) => { snapshot = Object.freeze(next); listeners.forEach((listener) => listener()); };

/** For tests: forget the member. */
export function resetCongregationStore(): void { snapshot = IDLE; listeners.forEach((listener) => listener()); }

type Client = Pick<ReturnType<typeof createDevotionClient>, 'getCongregation' | 'setCongregation'>;

function load(key: string, client: Client): void {
  if (snapshot.key === key && (snapshot.status === 'loading' || snapshot.status === 'ready')) return;
  publish({ key, status: 'loading', value: snapshot.key === key ? snapshot.value : null });
  void client.getCongregation()
    .then((value) => { if (snapshot.key === key) publish({ key, status: 'ready', value }); })
    .catch(() => { if (snapshot.key === key) publish({ key, status: 'error', value: snapshot.value }); });
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
  useEffect(() => { if (key && client) load(key, client); }, [key, client]);
  const mine = key && current.key === key ? current : { ...IDLE, key };
  return {
    ...mine,
    async choose(value) {
      if (!key || !client) throw new Error('NOT_SIGNED_IN');
      const saved = await client.setCongregation(value);
      if (snapshot.key === key) publish({ key, status: 'ready', value: saved });
    },
  };
}
