import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backfillBibleVersion } from '../../server/bibleCacheBackfill';
import { createOfficialBibleAdapter } from '../../server/officialBibleAdapter';

// 維護者 2026-10-31：「本地我們應該就是把所有聖經都存下來才 25 MB，這沒問題」. Synthetic pages only, in the shapes
// officialBibleAdapter.test.ts uses: no scripture in the repository.
const p = 'ChapterContent-module__test__';
const BOOKS = { '1TI': 2, '2TI': 1 } as Record<string, number>;
function chapterHtml(reference: string) {
  const props = { versionData: { id: 46, local_title: 'Synthetic fixture edition', local_abbreviation: 'FIX', language: { language_tag: 'zho_tw', text_direction: 'ltr' }, publisher: { name: 'Synthetic publisher' }, copyright_short: { text: 'Synthetic copyright', html: '<p>Synthetic copyright</p>' } }, chapterInfo: { reference: { usfm: [reference], human: `Fixture ${reference}`, version_id: 46 }, copyright: { text: 'Synthetic copyright' } } };
  const flight = `8:${JSON.stringify(['$', 'Component', null, { pageProps: props }])}\n`;
  return `<html><body><div data-testid="chapter-content"><div data-vid="46" class="version"><div class="${p}chapter" data-usfm="${reference}"><div class="${p}label">1</div><div class="${p}p"><span class="${p}verse" data-usfm="${reference}.1"><span class="${p}label">1</span><span class="${p}content">Synthetic text.</span></span></div></div></div></div><script>self.__next_f.push(${JSON.stringify([1, flight])})</script></body></html>`;
}
function indexHtml() {
  const books = Object.entries(BOOKS).map(([book, count]) => `<div><h3>Fixture ${book}</h3><div>${Array.from({ length: count }, (_, i) => `<a href="/bible/46/${book}.${i + 1}.FIX" aria-label="Fixture ${book} ${i + 1}">${i + 1}</a>`).join('')}</div></div>`).join('');
  return `<html><head><link rel="canonical" href="https://www.bible.com/versions/46-fixture"></head><body><div><h2>New Testament</h2>${books}</div></body></html>`;
}
const bibleCom = () => vi.fn(async (url: string) => new Response(url.includes('/versions/') ? indexHtml() : chapterHtml(url.split('/')[5]), { status: 200, headers: { 'content-type': 'text/html' } }));

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'qm-bible-backfill-')); dirs.push(dir); return dir; };

describe('storing a whole Bible version on the server disk', () => {
  it('reads the book list and every chapter once, pausing after each one from bible.com', async () => {
    const dir = tempDir();
    const fetcher = bibleCom();
    const sleep = vi.fn(async () => {});
    const result = await backfillBibleVersion({ versionId: 46, diskCacheDir: dir, pauseMs: 1500, fetcher, sleep });
    expect(result).toEqual({ chapters: 3, fromBibleCom: 3, failed: [] });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[1500], [1500], [1500]]);
    expect(readdirSync(join(dir, '46')).sort()).toEqual(['1TI.1.json', '1TI.2.json', '2TI.1.json', 'index.json']);
  });

  it('leaves the server a chapter nobody opened yet, readable with bible.com unreachable', async () => {
    const dir = tempDir();
    await backfillBibleVersion({ versionId: 46, diskCacheDir: dir, pauseMs: 0, fetcher: bibleCom(), sleep: async () => {} });
    const offline = vi.fn(async () => { throw new Error('bible.com must not be called'); });
    const lines: string[] = [];
    const server = createOfficialBibleAdapter({ diskCacheDir: dir, fetcher: offline, log: (line) => lines.push(line) });
    const answer = await server({ method: 'GET', url: '/v1/bibles/46/passages/2TI.1', headers: {} });
    expect(answer?.status).toBe(200);
    expect(offline).not.toHaveBeenCalled();
    expect(lines).toEqual([expect.stringMatching(/^BIBLE_REQUEST path=\/v1\/bibles\/46\/passages\/2TI\.1 source=disk status=200 /)]);
  });

  it('asks bible.com nothing and waits for nothing on a second run', async () => {
    const dir = tempDir();
    await backfillBibleVersion({ versionId: 46, diskCacheDir: dir, pauseMs: 0, fetcher: bibleCom(), sleep: async () => {} });
    const offline = vi.fn(async () => { throw new Error('bible.com must not be called'); });
    const sleep = vi.fn(async () => {});
    expect(await backfillBibleVersion({ versionId: 46, diskCacheDir: dir, pauseMs: 1500, fetcher: offline, sleep })).toEqual({ chapters: 3, fromBibleCom: 0, failed: [] });
    expect(offline).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('lists a chapter bible.com refused, and stops when bible.com keeps refusing', async () => {
    const refusing = (bad: (usfm: string) => boolean) => vi.fn(async (url: string) => {
      if (url.includes('/versions/')) return new Response(indexHtml(), { status: 200 });
      const usfm = url.split('/')[5];
      return bad(usfm) ? new Response('busy', { status: 503 }) : new Response(chapterHtml(usfm), { status: 200 });
    });
    const sleep = vi.fn(async () => {});
    const once = await backfillBibleVersion({ versionId: 46, diskCacheDir: tempDir(), pauseMs: 1500, fetcher: refusing((usfm) => usfm === '1TI.2'), sleep });
    expect(once).toEqual({ chapters: 3, fromBibleCom: 2, failed: ['1TI.2:502'] });
    expect(sleep).toHaveBeenCalledTimes(3);
    await expect(backfillBibleVersion({ versionId: 46, diskCacheDir: tempDir(), pauseMs: 0, maxFailuresInARow: 2, fetcher: refusing(() => true), sleep }))
      .rejects.toThrow('BACKFILL_STOPPED after 2 failures in a row, last 1TI.2:502');
  });
});
