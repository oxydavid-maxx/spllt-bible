import { useEffect } from 'react';
import { runtimeConfig } from '../../config/runtime';
import type { AuthSession } from '../../services/authSession';
import { createDevotionClient } from '../../services/devotionClient';
import { afterNextFrame, viewCache, viewCacheKey } from '../../services/viewCache';

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
    if (viewCache.peek(key) !== undefined || viewCache.failed(key)) return;
    const client = createDevotionClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: sessionToken, memberId });
    const later = afterNextFrame(() => viewCache.prefetch(key, () => client.getDevotional(date), 0, { joinAnyInflight: true }));
    return later.cancel;
  }, [memberId, sessionToken, date]);
}
