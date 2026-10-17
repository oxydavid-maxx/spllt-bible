import { notifyAuthExpired } from './authState';
import { GamificationApiError } from './gamificationApiClient';

/**
 * The 積分 page's 團體 / 個人 data and the 靈修 tab (維護者 2026-10-14). See server/devotionProgress.ts
 * and server/devotional.ts. 靈修 earns no points; nothing here touches the completion queue.
 */

export interface DevotionalSection { heading: string; paragraphs: string[] }
export interface DevotionalPost {
  date: string;
  weekday: string;
  passages: string;
  title: string;
  sections: DevotionalSection[];
  song: { youtubeId: string; title: string | null };
}

export interface GroupPrizeProgress {
  id: string;
  name: string;
  icon: 'beanbag' | 'sofa';
  members: number;
  months: number;
  qualifiedThisMonth: number;
  achievedMonths: number;
}

/** 青少/主堂 (維護者 2026-10-17); see server/congregation.ts. */
export type Congregation = 'youth' | 'main';

export interface GroupReading {
  /** 青少 counts 青少 and has the group prizes; 主堂 counts the whole church. An older server sends none: 青少. */
  scope: Congregation;
  month: string;
  today: string;
  todayReaders: number | null;
  yesterdayReaders: number | null;
  days: Array<{ date: string; readers: number | null }>;
  monthReads: number;
  busiest: { date: string; readers: number } | null;
  qualifyingDays: number;
  prizes: GroupPrizeProgress[];
  myDaysThisMonth: number;
}

export interface ScoreHistory {
  from: string | null;
  today: string;
  points: number[];
  devotions: number[];
  months: Array<{ month: string; points: number; devotionDays: number }>;
}

export interface DevotionClient {
  getDevotional(date: string): Promise<DevotionalPost | null>;
  getDevotionDates(from: string, to: string): Promise<string[]>;
  setDevotion(date: string, completed: boolean): Promise<void>;
  getGroupReading(month: string): Promise<GroupReading>;
  getScoreHistory(): Promise<ScoreHistory>;
  /** Null until the member has chosen (a member from before the split is 青少 already). */
  getCongregation(): Promise<Congregation | null>;
  setCongregation(value: Congregation): Promise<Congregation>;
}

export interface DevotionClientOptions { baseUrl: string; token: string; memberId: string; fetchImpl?: typeof fetch; timeoutMs?: number }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const countOrNull = (value: unknown): value is number | null => value === null || count(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const invalid = () => new GamificationApiError('INVALID_API_RESPONSE', false, 200);

export function parseDevotionalPost(value: unknown): DevotionalPost | null {
  const item = object(value);
  const song = object(item?.song);
  if (!item || !song || !text(item.date) || !DATE.test(item.date) || !text(item.weekday) || !text(item.passages) || !text(item.title) || !Array.isArray(item.sections)) return null;
  const sections = item.sections.map((section) => {
    const entry = object(section);
    return entry && text(entry.heading) && Array.isArray(entry.paragraphs) && entry.paragraphs.length > 0 && entry.paragraphs.every(text)
      ? { heading: entry.heading, paragraphs: entry.paragraphs as string[] } : null;
  });
  if (sections.length === 0 || sections.some((section) => !section) || !text(song.youtubeId) || !(song.title === null || text(song.title))) return null;
  return { date: item.date, weekday: item.weekday, passages: item.passages, title: item.title, sections: sections as DevotionalSection[], song: { youtubeId: song.youtubeId, title: song.title as string | null } };
}

export function parseGroupReading(value: unknown): GroupReading | null {
  const item = object(value);
  if (!item || !text(item.month) || !text(item.today) || !countOrNull(item.todayReaders) || !countOrNull(item.yesterdayReaders) || !Array.isArray(item.days) || !count(item.monthReads) || !count(item.qualifyingDays) || !Array.isArray(item.prizes) || !count(item.myDaysThisMonth)) return null;
  const days = item.days.map((day) => { const entry = object(day); return entry && text(entry.date) && countOrNull(entry.readers) ? { date: entry.date, readers: entry.readers } : null; });
  const busiest = item.busiest === null ? null : object(item.busiest);
  const prizes = item.prizes.map((prize) => {
    const entry = object(prize);
    return entry && text(entry.id) && text(entry.name) && (entry.icon === 'beanbag' || entry.icon === 'sofa') && count(entry.members) && count(entry.months) && count(entry.qualifiedThisMonth) && count(entry.achievedMonths)
      ? entry as unknown as GroupPrizeProgress : null;
  });
  if (days.some((day) => !day) || prizes.some((prize) => !prize) || (item.busiest !== null && !(busiest && text(busiest.date) && count(busiest.readers)))) return null;
  return {
    scope: item.scope === 'main' ? 'main' : 'youth',
    month: item.month, today: item.today, todayReaders: item.todayReaders, yesterdayReaders: item.yesterdayReaders,
    days: days as GroupReading['days'], monthReads: item.monthReads, busiest: busiest ? { date: busiest.date as string, readers: busiest.readers as number } : null,
    qualifyingDays: item.qualifyingDays, prizes: prizes as GroupPrizeProgress[], myDaysThisMonth: item.myDaysThisMonth,
  };
}

export function parseScoreHistory(value: unknown): ScoreHistory | null {
  const item = object(value);
  if (!item || !(item.from === null || (text(item.from) && DATE.test(item.from))) || !text(item.today) || !Array.isArray(item.points) || !Array.isArray(item.devotions) || !Array.isArray(item.months)) return null;
  if (!item.points.every(count) || !item.devotions.every(count) || item.points.length !== item.devotions.length) return null;
  const months = item.months.map((month) => { const entry = object(month); return entry && text(entry.month) && count(entry.points) && count(entry.devotionDays) ? { month: entry.month, points: entry.points, devotionDays: entry.devotionDays } : null; });
  if (months.some((month) => !month)) return null;
  return { from: item.from as string | null, today: item.today, points: item.points as number[], devotions: item.devotions as number[], months: months as ScoreHistory['months'] };
}

export function createDevotionClient(options: DevotionClientOptions): DevotionClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try { response = await fetchImpl(`${options.baseUrl}${path}`, { ...init, signal: controller.signal, headers: { authorization: `Bearer ${options.token}`, ...(init.headers ?? {}) } }); }
    catch { throw new GamificationApiError(controller.signal.aborted ? 'READ_TIMEOUT' : 'NETWORK_ERROR', true, 0); }
    finally { clearTimeout(timer); }
    if (response.status === 401) notifyAuthExpired({ memberId: options.memberId, sessionToken: options.token });
    const body = await response.json().catch(() => null);
    if (!response.ok && response.status !== 404) {
      const detail = object(object(body)?.error);
      throw new GamificationApiError(text(detail?.code) ? detail.code : 'API_ERROR', response.status >= 500, response.status);
    }
    return { status: response.status, body };
  }
  return {
    async getDevotional(date) {
      const { status, body } = await request(`/api/devotional/${encodeURIComponent(date)}`);
      if (status === 404) return null;
      const post = parseDevotionalPost(body);
      if (!post) throw invalid();
      return post;
    },
    async getDevotionDates(from, to) {
      const { body } = await request(`/api/me/devotions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const dates = object(body)?.dates;
      if (!Array.isArray(dates) || !dates.every((date) => text(date) && DATE.test(date))) throw invalid();
      return dates as string[];
    },
    async setDevotion(date, completed) {
      // A backend older than 靈修 answers 404: the mark was not kept, so the screen puts it back.
      const { status } = await request(`/api/me/devotions/${encodeURIComponent(date)}`, { method: completed ? 'PUT' : 'DELETE' });
      if (status === 404) throw new GamificationApiError('DEVOTIONS_UNAVAILABLE', false, 404);
    },
    async getGroupReading(month) {
      const view = parseGroupReading((await request(`/api/points/group?month=${encodeURIComponent(month)}`)).body);
      if (!view) throw invalid();
      return view;
    },
    async getCongregation() {
      const { status, body } = await request('/api/me/congregation');
      // A server from before the split has no such route: everybody there is 青少.
      if (status === 404) return 'youth';
      const value = object(body)?.congregation;
      if (value !== null && value !== 'youth' && value !== 'main') throw invalid();
      return value;
    },
    async setCongregation(value) {
      const { status, body } = await request('/api/me/congregation', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ congregation: value }) });
      const saved = object(body)?.congregation;
      if (status === 404 || (saved !== 'youth' && saved !== 'main')) throw invalid();
      return saved;
    },
    async getScoreHistory() {
      const history = parseScoreHistory((await request('/api/me/score-history')).body);
      if (!history) throw invalid();
      return history;
    },
  };
}
