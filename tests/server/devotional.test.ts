import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createSongTitleLookup, devotionalPlayerPage, devotionalPlayerResponse, parseDevotionalPost, shortSongTitle } from '../../server/devotional';

// A made-up post in the pastor's format. The real posts live only on the backend host.
const POST = [
  '📖🌾 《 溪邊的樹 》',
  '2026.10.14 (三) 讀經：彼前5、詩118',
  '',
  '背誦經文： ',
  '測試書 1:1 第一節背誦。',
  '1:2 第二節背誦。',
  '',
  '默想經文：',
  '一段默想的文字。',
  '',
  '用經文禱告：',
  '一段禱告的文字。',
  '感謝祈求是奉主耶穌基督的名。',
  '阿們！',
  '',
  'https://youtu.be/hMjd_SqVje8?si=abc',
].join('\n');

describe('reading the pastor\'s post by rule', () => {
  it('finds the date, passages, three sections and the one song', () => {
    expect(parseDevotionalPost(POST)).toEqual({
      date: '2026-10-14', weekday: '三', passages: '彼前5、詩118', title: '溪邊的樹', youtubeId: 'hMjd_SqVje8',
      sections: [
        { heading: '背誦經文', paragraphs: ['測試書 1:1 第一節背誦。', '1:2 第二節背誦。'] },
        { heading: '默想經文', paragraphs: ['一段默想的文字。'] },
        { heading: '用經文禱告', paragraphs: ['一段禱告的文字。', '感謝祈求是奉主耶穌基督的名。阿們！'] },
      ],
    });
  });

  it('accepts Windows line endings', () => {
    expect(parseDevotionalPost(POST.replace(/\n/g, '\r\n'))?.date).toBe('2026-10-14');
  });

  it('treats a post that does not match the format as missing', () => {
    expect(parseDevotionalPost(POST.replace('📖🌾 《 溪邊的樹 》', '早安'))).toBeNull();
    expect(parseDevotionalPost(POST.replace('默想經文：', '想一想：'))).toBeNull();
    expect(parseDevotionalPost(POST.replace('https://youtu.be/hMjd_SqVje8?si=abc', ''))).toBeNull();
    expect(parseDevotionalPost(`${POST}\nhttps://youtu.be/ARTKg-qWnZU`)).toBeNull();
  });

  it('shortens the YouTube title to the song', () => {
    expect(shortSongTitle('詩篇16篇 詩歌 《 耶和華是我產業 》｜原文敬拜唱誦版｜每日靈修 #詩歌')).toBe('詩篇16篇 詩歌《耶和華是我產業》');
  });
});

describe('song titles from YouTube oEmbed', () => {
  it('asks once per video and keeps the answer', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ title: '某詩歌 《 歌名 》｜頻道', author_name: '測試《官方頻道 》' }), { status: 200 }));
    const lookup = createSongTitleLookup(fetchImpl as unknown as typeof fetch);
    expect(await lookup('hMjd_SqVje8')).toEqual({ title: '某詩歌《歌名》', channel: '測試《官方頻道 》' });
    expect(await lookup('hMjd_SqVje8')).toEqual({ title: '某詩歌《歌名》', channel: '測試《官方頻道 》' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives no title when YouTube refuses or the id is malformed', async () => {
    const lookup = createSongTitleLookup((async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    expect(await lookup('hMjd_SqVje8')).toBeNull();
    expect(await lookup('../etc/passwd')).toBeNull();
  });
});

describe('GET /api/devotional/:date', () => {
  const dirs: string[] = [];
  const databases: Array<{ close: () => void }> = [];
  afterEach(() => { databases.splice(0).forEach((database) => database.close()); dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });
  function setup(at = '2026-10-14T04:00:00Z') {
    const dir = mkdtempSync(join(tmpdir(), 'devotional-'));
    dirs.push(dir);
    writeFileSync(join(dir, '20261014.txt'), POST, 'utf8');
    writeFileSync(join(dir, '20261013.txt'), POST, 'utf8');
    const database = createDatabase({ members: [{ id: 'member-self', displayName: '自己', groupId: 'g' }] });
    databases.push(database);
    const api = createApiHandler({ db: database, fixtureToken: 'test-token', devotionalDir: dir, songTitle: async () => ({ title: '詩篇16篇 詩歌《耶和華是我產業》', channel: '測試頻道' }), now: () => new Date(at) });
    return { api, headers: { authorization: 'Bearer test-token', 'x-qingmu-member-id': 'member-self' } };
  }

  it('serves the day to a signed-in member', async () => {
    const { api, headers } = setup();
    const response = await api({ method: 'GET', url: '/api/devotional/2026-10-14', headers });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ date: '2026-10-14', passages: '彼前5、詩118', song: { youtubeId: 'hMjd_SqVje8', title: '詩篇16篇 詩歌《耶和華是我產業》', channel: '測試頻道' } });
  });

  it('keeps the devotional and existing title fallback when oEmbed fails', async () => {
    const { headers } = setup();
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const api = createApiHandler({ db: databases.at(-1) as ReturnType<typeof createDatabase>, fixtureToken: 'test-token', devotionalDir: dirs.at(-1), songTitle: createSongTitleLookup(fetchImpl as unknown as typeof fetch) });
    const response = await api({ method: 'GET', url: '/api/devotional/2026-10-14', headers });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ title: '溪邊的樹', song: { youtubeId: 'hMjd_SqVje8', title: null, channel: null } });
  });

  it('refuses without sign-in, and says not found for a missing day or a file of another date', async () => {
    const { api, headers } = setup();
    expect((await api({ method: 'GET', url: '/api/devotional/2026-10-14', headers: {} })).status).toBe(401);
    expect((await api({ method: 'GET', url: '/api/devotional/2026-10-12', headers })).status).toBe(404);
    // 20261013.txt holds the 10/14 post: a misfiled day is not shown under the wrong date.
    expect((await api({ method: 'GET', url: '/api/devotional/2026-10-13', headers })).status).toBe(404);
    expect((await api({ method: 'GET', url: '/api/devotional/..%2F..%2Fsecret', headers })).status).toBe(400);
  });

  // 2026-10-19: apps up to 0.5.34 keep a 404 (還沒有上傳) for the rest of the day but ask again after an error.
  // Until today's post arrives, today (Monday–Saturday, Taipei) answers a retryable error instead.
  it('answers a retryable not-yet-posted error for today only, until the post arrives', async () => {
    const thursday = setup('2026-10-14T23:30:00Z'); // 10/15 (四) 07:30 Taipei, no 20261015.txt yet
    const pending = await thursday.api({ method: 'GET', url: '/api/devotional/2026-10-15', headers: thursday.headers });
    expect(pending.status).toBe(503);
    expect(pending.body).toMatchObject({ error: { code: 'DEVOTIONAL_NOT_YET_POSTED', retryable: true } });
    expect((await thursday.api({ method: 'GET', url: '/api/devotional/2026-10-12', headers: thursday.headers })).status).toBe(404);
    expect((await thursday.api({ method: 'GET', url: '/api/devotional/2026-10-16', headers: thursday.headers })).status).toBe(404);
    expect((await thursday.api({ method: 'GET', url: '/api/devotional/2026-10-14', headers: thursday.headers })).status).toBe(200);
    const sunday = setup('2026-10-18T01:00:00Z'); // 10/18 (日): no devotional is posted on Sundays
    expect((await sunday.api({ method: 'GET', url: '/api/devotional/2026-10-18', headers: sunday.headers })).status).toBe(404);
  });
});

describe('the song player page', () => {
  it('embeds only a well-formed video id', () => {
    expect(devotionalPlayerPage('hMjd_SqVje8')).toContain("videoId:'hMjd_SqVje8'");
    expect(devotionalPlayerPage("x'));alert(1)//")).toBeNull();
    expect(devotionalPlayerResponse('GET', '/api/devotional/player?v=hMjd_SqVje8')).toMatchObject({ status: 200, contentType: 'text/html; charset=utf-8' });
    expect(devotionalPlayerResponse('GET', '/api/devotional/player?v=bad')).toMatchObject({ status: 400 });
    expect(devotionalPlayerResponse('GET', '/api/devotional/2026-10-14')).toBeNull();
  });
});
