import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ReaderPreferencesSnapshot, ReaderPreferencesStore } from '../services/readerPreferences';

/** Read the current account during render; never carry the previous account through local hook state. */
export function useReaderPreferences(memberId: string | null, store: ReaderPreferencesStore): ReaderPreferencesSnapshot {
  const getSnapshot = useCallback(() => store.getSnapshot(memberId), [memberId, store]);
  const snapshot = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  useEffect(() => { void store.load(memberId); }, [memberId, store]);
  return snapshot;
}
