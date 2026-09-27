import type { Announcement } from './build';

/** Everything but the time it was made, which is how two runs are told apart. */
export function contentOf(announcement: Announcement): string {
  const { generatedAt, ...rest } = announcement;
  void generatedAt;
  return JSON.stringify(rest);
}
