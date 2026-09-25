/**
 * Sign-ups for the next gathering, as the signed-in member may see them: a head count, whether they
 * signed up themselves, and which of their friends did. The names come from the church's own
 * sign-up form; the server keeps only members it could match and never returns anyone else's name.
 */

export interface EventRegistrationSummary {
  date: string;
  total: number;
  registered: boolean;
  friends: string[];
}

export interface EventRegistrationOptions {
  baseUrl: string;
  token: string;
  memberId: string;
  fetchImpl?: typeof fetch;
}

const REQUEST_TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;

/** The notice board writes "9/27"; pick the year that puts it nearest today (Taipei). */
export function eventDateFromLabel(label: string, now: Date = new Date()): string | null {
  const match = label.normalize('NFKC').match(/(\d{1,2})\s*[/月]\s*(\d{1,2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const today = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  const year = Number(today.slice(0, 4));
  let best: { iso: string; distance: number } | null = null;
  for (const candidateYear of [year - 1, year, year + 1]) {
    const iso = `${candidateYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const time = Date.parse(`${iso}T00:00:00Z`);
    if (Number.isNaN(time) || new Date(time).getUTCDate() !== day) continue;
    const distance = Math.abs(time - todayTime);
    if (distance <= 183 * DAY_MS && (!best || distance < best.distance)) best = { iso, distance };
  }
  return best?.iso ?? null;
}

/** Rebuilt from named keys, so nothing unexpected from the server can reach the screen. */
function parse(value: unknown): EventRegistrationSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.date !== 'string' || typeof item.total !== 'number' || !Number.isSafeInteger(item.total) || item.total < 0) return null;
  if (typeof item.registered !== 'boolean' || !Array.isArray(item.friends) || !item.friends.every((name) => typeof name === 'string')) return null;
  return { date: item.date, total: item.total, registered: item.registered, friends: item.friends as string[] };
}

export async function fetchEventRegistrations(options: EventRegistrationOptions, date: string): Promise<EventRegistrationSummary | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}/api/me/event-registrations?date=${encodeURIComponent(date)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${options.token}`, 'x-qingmu-member-id': options.memberId },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parse(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
