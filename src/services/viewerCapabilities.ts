import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { runtimeConfig } from '../config/runtime';
import { useAuthSnapshot } from './authSession';
import { subscribeAppActive } from './appVisibility';
import { createGamificationApiClient, type ViewerCapabilities } from './gamificationApiClient';

// Account has two administrator rows. A single visible event shares the actual request.
const reads = new Map<string, Promise<ViewerCapabilities>>();
export function readViewerCapabilities(key: string, load: () => Promise<ViewerCapabilities>, visibleRevision = 0): Promise<ViewerCapabilities> {
  key = JSON.stringify([key, visibleRevision]);
  const existing = reads.get(key);
  if (existing) return existing;
  const request = Promise.resolve().then(load);
  reads.set(key, request);
  const clear = () => { if (reads.get(key) === request) reads.delete(key); };
  void request.then(clear, clear);
  return request;
}

export function forgetViewerCapabilities(ownerKey: string): void {
  for (const key of reads.keys()) if ((JSON.parse(key) as unknown[])[0] === ownerKey) reads.delete(key);
}

export function useViewerCapabilities(): ViewerCapabilities | null {
  const auth = useAuthSnapshot();
  const session = auth.status === 'signed-in' ? auth.session : null;
  const key = session ? JSON.stringify([session.memberId, session.sessionToken, auth.epoch]) : null;
  const client = useMemo(() => session ? createGamificationApiClient({ baseUrl: runtimeConfig({ QINGMU_API_BASE_URL: process.env.EXPO_PUBLIC_QINGMU_API_BASE_URL }).apiBaseUrl, token: session.sessionToken, memberId: session.memberId }) : null, [key]);
  const [value, setValue] = useState<{ key: string; capabilities: ViewerCapabilities } | null>(null);
  const current = useRef(key); current.current = key;
  const focused = useRef(false);
  const requestGeneration = useRef(0);
  const refresh = useCallback((visibleRevision = 0) => {
    if (!key || !client) return;
    const generation = ++requestGeneration.current;
    void readViewerCapabilities(key, () => client.getCapabilities(), visibleRevision).then(capabilities => {
      if (current.current === key && focused.current && requestGeneration.current === generation) setValue({ key, capabilities });
    }).catch(() => { if (current.current === key && requestGeneration.current === generation) setValue(null); });
  }, [key, client]);
  useFocusEffect(useCallback(() => { focused.current = true; refresh(); return () => { focused.current = false; requestGeneration.current++; if (key) forgetViewerCapabilities(key); }; }, [refresh]));
  useEffect(() => subscribeAppActive(revision => { if (focused.current) refresh(revision); }), [refresh]);
  return value?.key === key ? value.capabilities : null;
}
