/**
 * The widths (pixels) the backend keeps a phone copy of a 主堂週刊 page at (2026-10-20). The 10/18 pages came in at
 * 2481 × 3509, about three times what a phone list shows, and the list waited 2–5 s on LTE. The list asks for the
 * smallest of these that covers its width (`?w=`, server/bulletinsResize.ts); full screen asks for the original, so
 * zoom keeps every detail. A short fixed list, as image CDNs do, so the backend makes a handful of files, not one per
 * phone. Shared by the app and the backend so both round the same way.
 */
export const BULLETIN_LIST_WIDTHS = [720, 1080, 1440] as const;

/**
 * The phone copy for a list `px` wide: the smallest width within 5% of it or wider (a page drawn 5% larger than its
 * picture looks the same), the largest for anything wider, null when there is no width to go by.
 */
export function bulletinListWidth(px: number): number | null {
  if (!Number.isFinite(px) || px <= 0) return null;
  return BULLETIN_LIST_WIDTHS.find((width) => width >= px * 0.95) ?? BULLETIN_LIST_WIDTHS[BULLETIN_LIST_WIDTHS.length - 1];
}
