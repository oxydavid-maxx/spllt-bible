/**
 * The weekly announcement, read straight from where it is published.
 *
 * This is the only part of the app that does not go through the backend, and that is the point: the
 * backend runs on one person's machine, and a notice board that goes dark when that machine reboots
 * is not a notice board. Everything here is a plain HTTPS GET of a few kilobytes.
 *
 * The last good copy is kept on the device. A failed fetch shows what was there before, marked with
 * its week, rather than an empty screen — being a week out of date is a much smaller problem than
 * looking broken.
 */

export const ANNOUNCEMENT_URL =
  'https://raw.githubusercontent.com/oxydavid-maxx/spllt-bible/main/announcements/latest.json';

const CACHE_KEY = 'qingmu.announcement.latest';
const TIMEOUT_MS = 8_000;

export interface SermonBlock {
  title: string | null;
  speaker: string | null;
  passage: string | null;
  audio: string | null;
  slides: string | null;
  transcript: string | null;
  youtube: string | null;
}

export interface PastWeek {
  week: string;
  title: string | null;
  speaker: string | null;
  audio: string | null;
  slides: string | null;
  transcript: string | null;
}

export interface Announcement {
  week: string;
  sermon: SermonBlock | null;
  next: { date: string; topic: string; owner: string | null; signup: string | null } | null;
  standing: Record<string, string> | null;
  past: PastWeek[];
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const orNull = (value: unknown): string | null => (text(value) ? value : null);

function parseSermon(value: unknown): SermonBlock | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const sermon: SermonBlock = {
    title: orNull(item.title), speaker: orNull(item.speaker), passage: orNull(item.passage),
    audio: orNull(item.audio), slides: orNull(item.slides), transcript: orNull(item.transcript),
    youtube: orNull(item.youtube),
  };
  return Object.values(sermon).some((entry) => entry !== null) ? sermon : null;
}

/**
 * Built from named keys, and tolerant of a file that carries more than this version knows about.
 *
 * A future run adding a field must not stop an older phone from rendering the rest, which is why
 * nothing here rejects an unexpected key — the opposite of the gamification parsers, where an
 * unexpected key is a privacy problem. Here it is just a newer publisher.
 */
export function parseAnnouncement(value: unknown): Announcement | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!text(item.week)) return null;

  const next = item.next && typeof item.next === 'object' ? item.next as Record<string, unknown> : null;
  const standing = item.standing && typeof item.standing === 'object' ? item.standing as Record<string, unknown> : null;

  const past: PastWeek[] = [];
  if (Array.isArray(item.past)) {
    for (const entry of item.past) {
      if (!entry || typeof entry !== 'object') continue;
      const week = entry as Record<string, unknown>;
      if (!text(week.week)) continue;
      past.push({
        week: week.week, title: orNull(week.title),
        speaker: typeof week.speaker === 'string' && week.speaker.trim() ? week.speaker.trim() : null,
        audio: orNull(week.audio), slides: orNull(week.slides), transcript: orNull(week.transcript),
      });
    }
  }

  return {
    week: item.week,
    sermon: parseSermon(item.sermon),
    next: next && text(next.date) && text(next.topic)
      ? { date: next.date, topic: next.topic, owner: orNull(next.owner), signup: orNull(next.signup) }
      : null,
    standing: standing
      ? Object.fromEntries(Object.entries(standing).filter((pair): pair is [string, string] => text(pair[1])))
      : null,
    past,
  };
}

export interface AnnouncementStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface AnnouncementResult {
  announcement: Announcement | null;
  /** True when this came off the device because the fetch failed. */
  stale: boolean;
}

export function createAnnouncementClient(options: {
  storage: AnnouncementStorage;
  url?: string;
  fetchImpl?: typeof fetch;
}) {
  const url = options.url ?? ANNOUNCEMENT_URL;
  const request = options.fetchImpl ?? fetch;
  let inFlight: { controller: AbortController; promise: Promise<AnnouncementResult> } | null = null;

  const cached = async (): Promise<Announcement | null> => {
    try {
      const raw = await options.storage.getItem(CACHE_KEY);
      return raw ? parseAnnouncement(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };

  return {
    readCached: cached,
    cancel(): void { inFlight?.controller.abort(); inFlight = null; },
    load(): Promise<AnnouncementResult> {
      if (inFlight) return inFlight.promise;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const cancelled = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('ANNOUNCEMENT_READ_CANCELLED')), { once: true });
      });
      const read = (async (): Promise<AnnouncementResult> => {
        const response = await request(url, { signal: controller.signal });
        if (!response.ok) return { announcement: await cached(), stale: true };
        const body = await response.text();
        const announcement = parseAnnouncement(JSON.parse(body));
        if (!announcement) return { announcement: await cached(), stale: true };
        if (controller.signal.aborted) throw new Error('ANNOUNCEMENT_READ_CANCELLED');
        // Only a payload that parsed is kept, so a bad publish cannot poison the device copy.
        await options.storage.setItem(CACHE_KEY, body).catch(() => undefined);
        return { announcement, stale: false };
      })();
      const promise = Promise.race([read, cancelled]).catch(async () => ({ announcement: await cached(), stale: true })).finally(() => {
        clearTimeout(timer);
        if (inFlight?.controller === controller) inFlight = null;
      });
      inFlight = { controller, promise };
      return promise;
    },
  };
}
