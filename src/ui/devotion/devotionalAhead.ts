import { useEffect } from 'react';
import { runtimeConfig } from '../../config/runtime';
import { isCurrentAuthSession, type AuthSession } from '../../services/authSession';
import { createDevotionClient } from '../../services/devotionClient';
import { noteMoment } from '../../services/switchLatencyProbe';
import { viewCache, viewCacheKey } from '../../services/viewCache';

/**
 * Today's 靈修 post, asked for as soon as the member is signed in, on whichever tab the app opens (光佑 2026-10-23:
 * 「速度要完全無感非常的快」): the reader's 靈修 tab then opens on it at once, even when it is tapped the moment the
 * reader appears. It goes into the shared store under the key the reader reads (src/ui/devotion/useReaderDevotion.tsx),
 * which keeps its own rules from there: one question at a time, asked again at a look when it is from an earlier visit,
 * 還沒有上傳 asked again at every look. Asked once per member, session and day; a failure is left to the reader's retry.
 */
export function useDevotionalAhead(session: Pick<AuthSession, 'memberId' | 'sessionToken'> | null, date: string): void {
  const memberId = session?.memberId ?? null;
  const sessionToken = session?.sessionToken ?? null;
  useEffect(() => {
    if (!memberId || !sessionToken) return;
    const key = viewCacheKey({ memberId, sessionToken }, 'devotional', date);
    const client = createDevotionClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: sessionToken, memberId });
    // Asked now (nothing is being switched at launch), and again if the store is emptied before the reader reads it
    // (a sign-in settling empties it): one ask at a time, none while a kept answer or a failure is there.
    const ask = () => {
      // Never for a member or session that is no longer signed in (the store empties on sign-out too).
      if (!isCurrentAuthSession({ memberId, sessionToken } as AuthSession)) return;
      if (viewCache.peek(key) !== undefined || viewCache.failed(key)) return;
      noteMoment('devotional-ahead', 'asked');
      viewCache.prefetch(key, () => client.getDevotional(date).then((post) => { noteMoment('devotional-ahead', 'answered'); return post; }), 0, { joinAnyInflight: true });
    };
    ask();
    return viewCache.subscribe(ask);
  }, [memberId, sessionToken, date]);
}
