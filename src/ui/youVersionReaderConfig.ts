import { bookAbbreviationZhTw } from '../domain/scriptureReference';

export interface YouVersionReaderConfig {
  references: string[];
  versionId: number;
  appKey: string;
  allowTechnicalProbe: boolean;
}

/** SDK apiHost is HTTPS and host-only; never silently discard URL credentials or a path. */
export function resolveReaderContentApiHost(baseUrl?: string): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url.host;
  } catch { return undefined; }
}

export function buildYouVersionReaderConfig(config: YouVersionReaderConfig) {
  const first = config.references[0]?.match(/^([A-Z0-9]+)\.(\d+)/);
  if (!first) throw new Error('YouVersion reader requires a Bible chapter reference');
  return {
    book: first[1],
    chapter: first[2],
    versionId: config.versionId,
    references: config.references,
    allowTechnicalProbe: config.allowTechnicalProbe,
  };
}

/** Build the official YouVersion app link for the reader's current chapter, never an old task reference. */
export function buildYouVersionChapterUrl(versionId: number | null, usfm: string): string | null {
  if (!Number.isSafeInteger(versionId) || versionId === null || versionId <= 0) return null;
  const match = usfm.trim().toUpperCase().match(/^([A-Z0-9]{3,4})\.(\d+)(?:-\d+)?(?:\.\d+(?:-\d+)?)?$/);
  if (!match || !bookAbbreviationZhTw(match[1])) return null;
  const chapter = Number(match[2]);
  if (!Number.isSafeInteger(chapter) || chapter <= 0) return null;
  return `https://www.bible.com/bible/${versionId}/${match[1]}.${chapter}`;
}
