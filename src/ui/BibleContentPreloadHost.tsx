import { useEffect } from 'react';
import { useYouVersion } from '@youversion/platform-react-native-expo-core';
import { createBibleContentPreloader } from '../services/bibleContentPreload';

/**
 * Mount inside the SDK's YouVersionProvider. The owner should render this only after
 * home/selection/preferences are ready and pass a generation key containing date and version.
 * It has no visual output and does not preload audio.
 */
export interface BibleContentPreloadHostProps {
  enabled: boolean;
  versionId: number | null;
  references: string[];
  activeReferenceIndex?: number;
  /** Change this when the reading date or selected version changes. */
  generationKey: string;
}

export function BibleContentPreloadHost({
  enabled,
  versionId,
  references,
  activeReferenceIndex = 0,
  generationKey,
}: BibleContentPreloadHostProps): null {
  const { fetchBibleContent } = useYouVersion();
  const referencesKey = references.join('|');

  useEffect(() => {
    if (!enabled || versionId === null || references.length === 0) return undefined;
    const preloader = createBibleContentPreloader(fetchBibleContent, { maxConcurrent: 2 });
    void preloader.enqueue({ versionId, references, activeReferenceIndex });
    return () => preloader.cancel();
  }, [activeReferenceIndex, enabled, fetchBibleContent, generationKey, referencesKey, versionId]);

  return null;
}
