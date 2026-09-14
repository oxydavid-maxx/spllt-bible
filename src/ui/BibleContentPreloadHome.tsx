import { YouVersionProvider } from '@youversion/platform-react-native-expo-core';
import type { ReactElement } from 'react';
import { resolveReaderContentApiHost } from './youVersionReaderConfig';
import { BibleContentPreloadHost } from './BibleContentPreloadHost';

/**
 * The reading home warms the same native store and request producer used by the
 * full screen reader. It renders no UI and stays disabled until the selected
 * schedule, account preferences and provider key are ready.
 */
export function BibleContentPreloadHome({ enabled, appKey, apiBaseUrl, versionId, references, generationKey }: {
  enabled: boolean;
  appKey: string | null;
  apiBaseUrl?: string;
  versionId: number | null;
  references: string[];
  generationKey: string;
}): null | ReactElement {
  const apiHost = resolveReaderContentApiHost(apiBaseUrl);
  if (!enabled || !appKey || versionId === null || references.length === 0 || !apiHost) return null;
  return <YouVersionProvider appKey={appKey} apiHost={apiHost} permittedVersionIds={[versionId]}>
    <BibleContentPreloadHost enabled versionId={versionId} references={references} generationKey={generationKey} />
  </YouVersionProvider>;
}
