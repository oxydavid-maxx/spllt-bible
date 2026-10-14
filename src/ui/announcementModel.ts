import type { Announcement, PastWeek, SermonBlock, SessionBlock } from '../services/announcementClient';

/**
 * The notice board's words and order (維護者 2026-10-14): one 講道紀錄 card per Sunday, newest first,
 * the latest marked 上週; a session with nothing of its own folds to one line; two files of one kind
 * are numbered 「報告投影片 1、2」 rather than printing their file names.
 */

export type LinkKind = 'audio' | 'slides' | 'doc' | 'video';
export interface BoardLink { label: string; url: string; kind: LinkKind }
export interface BoardSession { label: string | null; title: string; byline: string | null; links: BoardLink[]; compact: boolean }
export interface SermonWeek { week: string; latest: boolean; sessions: BoardSession[] }

const ROLE_LABEL = { audio: '錄音', sermonSlides: '講道投影片', slides: '報告投影片', transcript: '逐字稿', sermonDoc: '教材' } as const;
const ROLE_KIND: Record<keyof typeof ROLE_LABEL, LinkKind> = { audio: 'audio', sermonSlides: 'slides', slides: 'slides', transcript: 'doc', sermonDoc: 'doc' };
const ROLE_ORDER = ['audio', 'sermonSlides', 'slides', 'transcript', 'sermonDoc'] as const;

export function sessionLinks(session: SermonBlock | SessionBlock): BoardLink[] {
  const links: BoardLink[] = [];
  if ('materials' in session && session.materials?.length) {
    for (const role of ROLE_ORDER) {
      const files = session.materials.filter((file) => file.role === role);
      files.forEach((file, index) => links.push({ label: files.length > 1 ? `${ROLE_LABEL[role]} ${index + 1}` : ROLE_LABEL[role], url: file.url, kind: ROLE_KIND[role] }));
    }
  } else {
    const legacy: Array<[keyof typeof ROLE_LABEL, string | null | undefined]> = [['audio', session.audio], ['sermonSlides', session.sermonSlides], ['slides', session.slides], ['transcript', session.transcript]];
    for (const [role, url] of legacy) if (url) links.push({ label: ROLE_LABEL[role], url, kind: ROLE_KIND[role] });
  }
  if (session.youtube) links.push({ label: '影片', url: session.youtube, kind: 'video' });
  return links;
}

function boardSession(session: SermonBlock | SessionBlock, label: string | null): BoardSession {
  const byline = [session.speaker, session.passage].filter(Boolean).join(' · ') || null;
  const links = sessionLinks(session);
  // Nothing of its own (the usual 青少團契 Sunday): one line, its one file at the end if any.
  return { label, title: session.title ?? '講道', byline, links, compact: !byline && links.length <= 1 && label !== null };
}

function pastSessions(week: PastWeek): BoardSession[] {
  if (week.sessions?.length) return week.sessions.map((session) => boardSession(session, week.sessions!.length > 1 ? session.label : null));
  return [boardSession({ title: week.title, speaker: week.speaker, passage: null, audio: week.audio, slides: week.slides, sermonSlides: week.sermonSlides, transcript: week.transcript, youtube: null }, null)];
}

/** Last Sunday (the announcement's own week), then the earlier ones, newest first. */
export function sermonWeeks(announcement: Announcement): SermonWeek[] {
  const weeks: SermonWeek[] = [];
  const recorded = announcement.sessions?.length ? announcement.sessions : announcement.sermon ? [{ ...announcement.sermon, label: '第一堂' }] : [];
  if (recorded.length) weeks.push({ week: announcement.week, latest: true, sessions: recorded.map((session) => boardSession(session, recorded.length > 1 ? session.label : null)) });
  const past = [...announcement.past].sort((left, right) => right.week.localeCompare(left.week));
  // Only the announcement's own week is 上週; an older week is never called that.
  for (const week of past) weeks.push({ week: week.week, latest: false, sessions: pastSessions(week) });
  return weeks;
}

export function shortWeek(week: string, today: string): string {
  const [year, month, day] = week.split('-');
  const date = `${Number(month)}/${Number(day)}`;
  return year === today.slice(0, 4) ? date : `${year}/${date}`;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** The next gathering's 「10 月 / 18 / 週日」 block, from its M/D and the announcement's week. */
export function nextDateBlock(date: string, week: string): { month: string; day: string; weekday: string | null } | null {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(date.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const weekYear = Number(week.slice(0, 4));
  const year = month < Number(week.slice(5, 7)) ? weekYear + 1 : weekYear;
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  const valid = value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
  return { month: `${month} 月`, day: String(day), weekday: valid ? `週${WEEKDAYS[value.getUTCDay()]}` : null };
}

/** 「主領(報告)」 → 「主領」, 「敬拜團+詩歌」 → 「敬拜團」: the roster's notes stay off the grid. */
export function shortRole(label: string): string {
  const cut = label.split(/[+＋(（]/)[0].trim();
  return cut || label;
}
