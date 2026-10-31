import { createOfficialBibleAdapter, type OfficialBibleAdapterOptions } from './officialBibleAdapter';

/**
 * 整本經文先存進後端硬碟 (維護者 2026-10-31：「本地我們應該就是把所有聖經都存下來才 25 MB，這沒問題」). The disk tier
 * of officialBibleAdapter keeps only chapters someone already opened, so the first reader of any other chapter still
 * waits on bible.com. This reads the version's book list and then every chapter through the same adapter, so each one
 * lands in the folder and format the server reads; a chapter already on disk costs no request. After each chapter that
 * had to come from bible.com (or failed) it waits `pauseMs`, and it stops after `maxFailuresInARow` failures, so a
 * bible.com that refuses us is not asked a thousand times. Running it again fills in what failed.
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
  const handle = createOfficialBibleAdapter({
    diskCacheDir: options.diskCacheDir,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    log: (line) => { source = line.match(/ source=(\S+)/)?.[1] ?? source; },
  });
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const get = async (path: string) => {
    source = '';
    const result = await handle({ method: 'GET', url: path, headers: {} });
    return { status: result?.status ?? 0, body: result?.body as { data?: { id: string; chapters: { passage_id: string }[] }[] }, source };
  };
  const books = await get(`/v1/bibles/${options.versionId}/books`);
  if (books.status !== 200 || !Array.isArray(books.body?.data)) throw new Error(`BACKFILL_INDEX_FAILED version=${options.versionId} status=${books.status}`);
  const limit = options.maxFailuresInARow ?? 5;
  const result: BackfillResult = { chapters: 0, fromBibleCom: 0, failed: [] };
  let failuresInARow = 0;
  for (const book of books.body.data) {
    for (const { passage_id: usfm } of book.chapters) {
      const page = await get(`/v1/bibles/${options.versionId}/passages/${usfm}`);
      result.chapters += 1;
      if (page.status === 200) failuresInARow = 0;
      else {
        result.failed.push(`${usfm}:${page.status}`);
        failuresInARow += 1;
        if (failuresInARow >= limit) throw new Error(`BACKFILL_STOPPED after ${failuresInARow} failures in a row, last ${usfm}:${page.status}`);
      }
      if (page.source === 'bible.com') result.fromBibleCom += 1;
      if (page.source === 'bible.com' || page.status !== 200) await sleep(options.pauseMs);
    }
    options.progress?.(`BACKFILL_BOOK version=${options.versionId} book=${book.id} chapters=${result.chapters} from_bible_com=${result.fromBibleCom} failed=${result.failed.length}`);
  }
  return result;
}
