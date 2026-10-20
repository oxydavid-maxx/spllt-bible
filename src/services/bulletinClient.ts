/**
 * 主堂週刊 (維護者 2026-10-17): the pages the church office posts to the LINE group, kept by the backend for the
 * newest 8 Sundays (server/bulletins.ts). Members only; the page images are fetched with the same bearer token.
 */
export interface BulletinPage { index: number; width: number; height: number }
export interface BulletinWeek { date: string; postedAt: string; pages: BulletinPage[] }

export interface BulletinClientOptions { baseUrl: string; token: string; memberId: string; fetchImpl?: typeof fetch }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function parseWeek(value: unknown): BulletinWeek | null {
  const week = value as Partial<BulletinWeek> | null;
  if (!week || typeof week.date !== 'string' || !DATE.test(week.date) || typeof week.postedAt !== 'string' || !Array.isArray(week.pages) || week.pages.length === 0) return null;
  const pages = week.pages.map((page) => (page && positive(page.index) && positive(page.width) && positive(page.height) ? { index: page.index, width: page.width, height: page.height } : null));
  return pages.every(Boolean) ? { date: week.date, postedAt: week.postedAt, pages: pages as BulletinPage[] } : null;
}

/** Newest first. An older backend without bulletins gives an empty list; null means it could not be read. */
export async function fetchBulletins(options: BulletinClientOptions): Promise<BulletinWeek[] | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${options.baseUrl}/api/bulletins`, { headers: { authorization: `Bearer ${options.token}` } });
    if (response.status === 404) return [];
    if (!response.ok) return null;
    const weeks = ((await response.json()) as { weeks?: unknown }).weeks;
    if (!Array.isArray(weeks)) return null;
    const parsed = weeks.map(parseWeek);
    return parsed.every(Boolean) ? parsed as BulletinWeek[] : null;
  } catch {
    return null;
  }
}

/**
 * An image source the app's Image can load with the member's token. An array on purpose, on both platforms: React
 * Native 0.85's Android Image passes `headers` to the native view only when `source` is an array
 * (Libraries/Image/Image.android.js); a single `{ uri, headers }` loses the token there, the page answers 401 and stays
 * blank (Pixel, 0.5.34, 2026-10-19). iOS reads the headers either way. Guard: tests/ui/imageSourceHeaders.test.ts.
 *
 * `width` asks for the backend's phone copy of the page (src/domain/bulletinWidths.ts): the list uses it, full screen
 * leaves it out and gets the original. A backend from before 2026-10-20 ignores it and sends the original.
 */
export function bulletinPageSource(baseUrl: string, token: string, date: string, index: number, width?: number): [{ uri: string; headers: Record<string, string> }] {
  return [{ uri: `${baseUrl}/api/bulletins/${date}/${index}${width ? `?w=${width}` : ''}`, headers: { authorization: `Bearer ${token}` } }];
}

/** 「10/11 (日) 週刊」: bulletins are dated by their Sunday. */
export function bulletinHeading(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}/${day} (日) 週刊`;
}
