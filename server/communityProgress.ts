import type { DatabaseSync } from 'node:sqlite';
import { ZH_TW_BOOK_ABBREVIATIONS } from '../src/domain/scriptureReference';

/**
 * What the youth group has read together, shown and nothing else.
 *
 * No target, no progress bar toward one, no reward for reaching it, and no wording that could read
 * as "we still need N". It only ever goes up, so on a week when hardly anyone read it stays quiet
 * instead of turning into an accusation. That is what keeps this a display rather than the shared
 * mission the product deliberately does not have.
 */

/**
 * A count is withheld until the group is large enough to hide an individual inside it.
 *
 * With three members, subtracting your own total from the group's tells you the other two. Ten is
 * the same threshold the tier calculation already uses, so this is not a new rule to remember.
 */
const MIN_MEMBERS_FOR_SHARED_COUNT = 10;

export interface CommunityProgress {
  /** Books the plan has walked through up to today, newest last. Null count aside, always present. */
  books: string[];
  /** Total days read across everyone, or null while that number would give away a person. */
  personDays: number | null;
}

export function getCommunityProgress(db: DatabaseSync, today: string): CommunityProgress {
  const rows = db
    .prepare('SELECT references_json FROM reading_days WHERE task_date <= ? ORDER BY task_date')
    .all(today) as Array<{ references_json: string }>;

  // Derived from the plan, not from anybody's record, which is why it is true on the very first day
  // and stays true however few people have signed in.
  const seen: string[] = [];
  for (const row of rows) {
    let references: string[];
    try { references = JSON.parse(row.references_json) as string[]; } catch { continue; }
    for (const reference of references) {
      const book = String(reference).split('.')[0];
      const name = ZH_TW_BOOK_ABBREVIATIONS[book];
      if (name && !seen.includes(name)) seen.push(name);
    }
  }

  const scoring = db
    .prepare('SELECT COUNT(DISTINCT member_id) AS members, COALESCE(SUM(amount), 0) AS total FROM daily_point_entitlements WHERE active = 1')
    .get() as { members: number; total: number };
  const enabled = db
    .prepare('SELECT COUNT(*) AS count FROM members WHERE disabled_at IS NULL OR disabled_at = 0')
    .get() as { count: number };

  const crowdEnough = Number(enabled.count) >= MIN_MEMBERS_FOR_SHARED_COUNT
    && Number(scoring.members) >= MIN_MEMBERS_FOR_SHARED_COUNT;

  return { books: seen, personDays: crowdEnough ? Math.max(0, Number(scoring.total)) : null };
}
