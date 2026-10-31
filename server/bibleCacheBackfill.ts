import { createOfficialBibleAdapter, type OfficialBibleAdapterOptions } from './officialBibleAdapter';

/**
 * 整本經文先存進後端硬碟 (維護者 2026-10-31：「本地我們應該就是把所有聖經都存下來才 25 MB，這沒問題」). The disk tier
 * of officialBibleAdapter keeps only chapters someone already opened, so the first reader of any other chapter still
 * waits on bible.com. This reads the version's book list and then every chapter through the same adapter, so each one
 * lands in the folder and format the server reads; a chapter already on disk costs no request. After each chapter that
 * had to come from bible.com (or failed) it waits `pauseMs`, and it stops after `maxFailuresInARow` failures, so a
 * bible.com that refuses us is not asked a thousand times. A chapter the adapter read but could not write to disk
 * (it only logs BIBLE_CACHE_WRITE_FAILED) is a failure too (Codex review), so a full disk never reads as done.
 * Running it again fills in what failed.
 */
export interface BackfillOptions {
  versionId: number;
  diskCacheDir: string;
  pauseMs: number;
  maxFailuresInARow?: number;
  fetcher?: OfficialBibleAdapterOptions['fetcher'];
  sleep?: (ms: number) => Promise<void>;
  progress?: (line: string) => void;
}
export interface BackfillResult { chapters: number; fromBibleCom: number; failed: string[] }

export async function backfillBibleVersion(options: BackfillOptions): Promise<BackfillResult> {
  let source = '';
  let writeFailed = false;
  const handle = createOfficialBibleAdapter({
    diskCacheDir: options.diskCacheDir,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    log: (line) => {
      if (line.startsWith('BIBLE_CACHE_WRITE_FAILED ')) writeFailed = true;
      else source = line.match(/ source=(\S+)/)?.[1] ?? source;
    },
  });
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const get = async (path: string) => {
    source = '';
    writeFailed = false;
    const result = await handle({ method: 'GET', url: path, headers: {} });
    const status = result?.status ?? 0;
    return { status, failure: status !== 200 ? String(status) : writeFailed ? 'write' : null, body: result?.body as { data?: { id: string; chapters: { passage_id: string }[] }[] }, source };
  };
  const books = await get(`/v1/bibles/${options.versionId}/books`);
  if (books.failure || !Array.isArray(books.body?.data)) throw new Error(`BACKFILL_INDEX_FAILED version=${options.versionId} reason=${books.failure ?? 'shape'}`);
  const limit = options.maxFailuresInARow ?? 5;
  const result: BackfillResult = { chapters: 0, fromBibleCom: 0, failed: [] };
  let failuresInARow = 0;
  for (const book of books.body.data) {
    for (const { passage_id: usfm } of book.chapters) {
      const page = await get(`/v1/bibles/${options.versionId}/passages/${usfm}`);
      result.chapters += 1;
      if (!page.failure) failuresInARow = 0;
      else {
        result.failed.push(`${usfm}:${page.failure}`);
        failuresInARow += 1;
        if (failuresInARow >= limit) throw new Error(`BACKFILL_STOPPED after ${failuresInARow} failures in a row, last ${usfm}:${page.failure}`);
      }
      if (page.source === 'bible.com') result.fromBibleCom += 1;
      if (page.source === 'bible.com' || page.failure) await sleep(options.pauseMs);
    }
    options.progress?.(`BACKFILL_BOOK version=${options.versionId} book=${book.id} chapters=${result.chapters} from_bible_com=${result.fromBibleCom} failed=${result.failed.length}`);
  }
  return result;
}
