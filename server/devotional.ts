import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The pastor's daily devotional (《溪邊的樹》), read by the 靈修 tab of the reading page.
 *
 * The post arrives as plain text, one file per day named YYYYMMDD.txt, in a private folder on the
 * backend host (QINGMU_DEVOTIONAL_DIR). Nothing of it lives in this public repository: tests use
 * made-up posts. The format has been the same every day, so fixed rules read it; a post that does not
 * match is treated as missing rather than shown half-parsed.
 */

export interface DevotionalSection {
  heading: string;
  paragraphs: string[];
}

export interface DevotionalPost {
  date: string;
  /** 一 … 日, as the post writes it. */
  weekday: string;
  /** The passages line as written, e.g. 「彼前5、詩118」. */
  passages: string;
  title: string;
  sections: DevotionalSection[];
  youtubeId: string;
}

export interface DevotionalView extends Omit<DevotionalPost, 'youtubeId'> {
  song: { youtubeId: string; title: string | null };
}

const HEADER = /^📖🌾\s*《\s*(.+?)\s*》\s*$/u;
const DATE_LINE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})\s*\((.)\)\s*讀經[:：]\s*(.+?)\s*$/u;
const SECTION_NAMES = ['背誦經文', '默想經文', '用經文禱告'] as const;
const SECTION_LINE = /^(背誦經文|默想經文|用經文禱告)\s*[:：]\s*(.*)$/u;
const YOUTUBE = /https?:\/\/(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/watch\?v=)([\w-]{11})\S*/gu;
const YOUTUBE_ID = /^[\w-]{11}$/;
// A line this short ends the previous one (「阿們！」 under 「…奉主耶穌基督的名。」).
const CONTINUATION_MAX = 4;

export function isDevotionalDate(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);
}

export function parseDevotionalPost(text: string): DevotionalPost | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim());
  const header = lines[0] ? HEADER.exec(lines[0]) : null;
  const dateLine = lines[1] ? DATE_LINE.exec(lines[1]) : null;
  if (!header || !dateLine) return null;
  const videos = [...text.matchAll(YOUTUBE)].map((match) => match[1]);
  if (new Set(videos).size !== 1) return null;
  const date = `${dateLine[1]}-${dateLine[2].padStart(2, '0')}-${dateLine[3].padStart(2, '0')}`;
  if (!isDevotionalDate(date)) return null;
  const bodies = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines.slice(2)) {
    const section = SECTION_LINE.exec(line);
    if (section) {
      current = section[1];
      bodies.set(current, section[2] ? [section[2]] : []);
      continue;
    }
    if (current) bodies.get(current)!.push(line.replace(YOUTUBE, '').trim());
  }
  const sections: DevotionalSection[] = [];
  for (const heading of SECTION_NAMES) {
    const paragraphs = joinParagraphs(bodies.get(heading) ?? []);
    if (paragraphs.length === 0) return null;
    sections.push({ heading, paragraphs });
  }
  return { date, weekday: dateLine[4], passages: dateLine[5], title: header[1], sections, youtubeId: videos[0] };
}

function joinParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (paragraphs.length > 0 && [...line].length <= CONTINUATION_MAX) paragraphs[paragraphs.length - 1] += line;
    else paragraphs.push(line);
  }
  return paragraphs;
}

/** 「詩篇16篇 詩歌 《 耶和華是我產業 》｜原文敬拜唱誦版｜…」 → 「詩篇16篇 詩歌《耶和華是我產業》」. */
export function shortSongTitle(title: string): string | null {
  const head = title.split(/[｜|#【]/u)[0]
    .replace(/\s*《\s*/gu, '《').replace(/\s*》\s*/gu, '》 ').replace(/\s+/gu, ' ').trim();
  return head || null;
}

export type SongTitleLookup = (youtubeId: string) => Promise<string | null>;

/**
 * YouTube's public oEmbed answers with the video title, and with an error when the owner does not
 * allow embedding. One lookup per video, kept for the life of the process: the title never changes.
 */
export function createSongTitleLookup(fetchImpl: typeof fetch = fetch, timeoutMs = 3000): SongTitleLookup {
  const cache = new Map<string, Promise<string | null>>();
  return (youtubeId) => {
    if (!YOUTUBE_ID.test(youtubeId)) return Promise.resolve(null);
    let pending = cache.get(youtubeId);
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${youtubeId}`)}`, { signal: AbortSignal.timeout(timeoutMs) });
          if (!response.ok) return null;
          const body = await response.json() as { title?: unknown };
          return typeof body.title === 'string' ? shortSongTitle(body.title) : null;
        } catch {
          cache.delete(youtubeId);
          return null;
        }
      })();
      cache.set(youtubeId, pending);
    }
    return pending;
  };
}

export async function readDevotional(dir: string | undefined, date: string, songTitle: SongTitleLookup): Promise<DevotionalView | null> {
  if (!dir || !isDevotionalDate(date)) return null;
  let text: string;
  try { text = await readFile(join(dir, `${date.replace(/-/g, '')}.txt`), 'utf8'); }
  catch { return null; }
  const post = parseDevotionalPost(text);
  if (!post || post.date !== date) return null;
  const { youtubeId, ...rest } = post;
  return { ...rest, song: { youtubeId, title: await songTitle(youtubeId) } };
}

/** GET /api/devotional/player?v=<id>: the page below, or null for every other request. */
export function devotionalPlayerResponse(method: string, rawUrl: string): { status: number; contentType: string; body: string } | null {
  const url = new URL(rawUrl, 'http://localhost');
  if (url.pathname !== '/api/devotional/player') return null;
  const page = method === 'GET' ? devotionalPlayerPage(url.searchParams.get('v') ?? '') : null;
  return page
    ? { status: 200, contentType: 'text/html; charset=utf-8', body: page }
    : { status: method === 'GET' ? 400 : 405, contentType: 'text/plain; charset=utf-8', body: 'bad request' };
}

/**
 * The song player the app opens in a web view. YouTube's embedded player refuses to play without a
 * page that embeds it (a bare embed URL has no referrer), so this backend serves that page. It only
 * ever embeds the id it was given and reports the player's state back to the app.
 */
export function devotionalPlayerPage(youtubeId: string): string | null {
  if (!YOUTUBE_ID.test(youtubeId)) return null;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#15302A;overflow:hidden}#p{position:absolute;inset:0;width:100%;height:100%}</style></head>
<body><div id="p"></div><script>
var post=function(t){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(t)}catch(e){}};
var player=null;window.qmPlay=function(){player&&player.playVideo&&player.playVideo()};window.qmPause=function(){player&&player.pauseVideo&&player.pauseVideo()};
window.onYouTubeIframeAPIReady=function(){player=new YT.Player('p',{videoId:'${youtubeId}',playerVars:{playsinline:1,rel:0,modestbranding:1},events:{
onReady:function(){post('ready')},onStateChange:function(e){post(e.data===1?'playing':e.data===2?'paused':e.data===0?'ended':'state:'+e.data)},onError:function(e){post('error:'+e.data)}}})};
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
}
