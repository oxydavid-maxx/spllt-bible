import type { DatabaseSync } from 'node:sqlite';
import { ZH_TW_BOOK_ABBREVIATIONS, ZH_TW_BOOK_NAMES } from '../src/domain/scriptureReference';

/**
 * What the youth group has read together.
 *
 * The running display has no target and no wording that could read as "we still need N". It only
 * ever goes up, so on a week when hardly anyone read it stays quiet instead of turning into an
 * accusation.
 *
 * The shared goal underneath it is built to the same rule, and it is the only one this product has.
 * A chapter lights up the moment ANY one person has read it, there is no deadline, and nothing
 * counts down, so it cannot be failed. That inverts what a group target usually does to whoever read
 * least: instead of a gap with their name on it, they find the chapters somebody else carried while
 * they were away.
 */

/**
 * A count is withheld until the group is large enough to hide an individual inside it.
 *
 * With three members, subtracting your own total from the shared one tells you the other two. Ten is
 * the same threshold the tier calculation already uses, so this is not a new rule to remember.
 */
const MIN_MEMBERS_FOR_SHARED_COUNT = 10;

export interface CommunityChapter {
  chapter: number;
  /**
   * How many people have read it, or null when nobody has yet.
   *
   * Null rather than 0, on purpose. A row of noughts standing in front of the chapters still to come
   * reads as a scoreboard of failures, and there is no honest way to draw a 0 that does not. With no
   * number there, a chapter nobody has reached is simply unlit, which is all it is.
   */
  readers: number | null;
}

export interface CommunityBookGoal {
  /** Full name, because this is read as a sentence: 一起讀完 提摩太前書. */
  book: string;
  /** Every chapter of it the plan schedules, ascending. */
  chapters: CommunityChapter[];
  complete: boolean;
}

export interface CommunityProgress {
  /** Books the plan has walked through up to today, newest last. Null count aside, always present. */
  books: string[];
  /** Total days read across everyone, or null while that number would give away a person. */
  personDays: number | null;
  /** The book the group is finishing together, or null before the plan has started. */
  currentBook: CommunityBookGoal | null;
}

interface PlannedDay { taskDate: string; references: string[] }

function parsePlan(rows: Array<{ task_date: string; references_json: string }>): PlannedDay[] {
  const days: PlannedDay[] = [];
  for (const row of rows) {
    try { days.push({ taskDate: row.task_date, references: JSON.parse(row.references_json) as string[] }); }
    catch { continue; }
  }
  return days;
}

/** JHN.12.27-50 and JHN.12 are the same chapter; the verses only say how much of it that day. */
function splitReference(reference: string): { book: string; chapter: number } | null {
  const parts = String(reference).split('.');
  const chapter = Number(parts[1]);
  if (!parts[0] || !Number.isInteger(chapter) || chapter <= 0) return null;
  return { book: parts[0], chapter };
}

/**
 * Which book the group is working on, when two of them run side by side.
 *
 * The plan pairs a letter with a psalm most days, and both are genuinely current. The one that can
 * be a goal is the one with an end in sight, so this takes whichever of the current books the plan
 * finishes first. No list of which books count, and it still behaves for a plan that reads one
 * thing at a time.
 */
function chooseCurrentBook(days: PlannedDay[], today: string): string | null {
  let current: PlannedDay | null = null;
  for (const day of days) if (day.taskDate <= today && (!current || day.taskDate > current.taskDate)) current = day;
  if (!current) return null;

  const lastDay = new Map<string, string>();
  for (const day of days) {
    for (const reference of day.references) {
      const parsed = splitReference(reference);
      if (!parsed) continue;
      const known = lastDay.get(parsed.book);
      if (!known || day.taskDate > known) lastDay.set(parsed.book, day.taskDate);
    }
  }

  let chosen: string | null = null;
  for (const reference of current.references) {
    const parsed = splitReference(reference);
    // A book with no Chinese name is left alone rather than announced under a guessed one.
    if (!parsed || !ZH_TW_BOOK_NAMES[parsed.book]) continue;
    if (chosen === null || (lastDay.get(parsed.book) ?? '') < (lastDay.get(chosen) ?? '')) chosen = parsed.book;
  }
  return chosen;
}

function buildBookGoal(db: DatabaseSync, days: PlannedDay[], today: string): CommunityBookGoal | null {
  const book = chooseCurrentBook(days, today);
  if (!book) return null;

  // A chapter can be scheduled across more than one day, so it counts as read if any of them is.
  const chapterDays = new Map<number, string[]>();
  for (const day of days) {
    for (const reference of day.references) {
      const parsed = splitReference(reference);
      if (!parsed || parsed.book !== book) continue;
      const known = chapterDays.get(parsed.chapter);
      if (known) { if (!known.includes(day.taskDate)) known.push(day.taskDate); }
      else chapterDays.set(parsed.chapter, [day.taskDate]);
    }
  }
  if (chapterDays.size === 0) return null;

  const readersByDay = new Map<string, Set<string>>();
  const rows = db
    .prepare('SELECT DISTINCT member_id, task_date FROM daily_point_entitlements WHERE active = 1')
    .all() as Array<{ member_id: string; task_date: string }>;
  for (const row of rows) {
    const known = readersByDay.get(row.task_date);
    if (known) known.add(row.member_id);
    else readersByDay.set(row.task_date, new Set([row.member_id]));
  }

  const chapters: CommunityChapter[] = [...chapterDays.keys()].sort((a, b) => a - b).map((chapter) => {
    const people = new Set<string>();
    for (const taskDate of chapterDays.get(chapter) ?? []) {
      for (const member of readersByDay.get(taskDate) ?? []) people.add(member);
    }
    // Identifiers are gathered only to be counted. Only the size of the set leaves this function.
    return { chapter, readers: people.size > 0 ? people.size : null };
  });

  return { book: ZH_TW_BOOK_NAMES[book], chapters, complete: chapters.every((entry) => entry.readers !== null) };
}

export function getCommunityProgress(db: DatabaseSync, today: string): CommunityProgress {
  // The whole plan, not only the part already walked: the chapter list of a book and the date it
  // finishes on are both facts about the plan, and the chapters still ahead are what the goal is
  // made of.
  const plan = parsePlan(db
    .prepare('SELECT task_date, references_json FROM reading_days ORDER BY task_date')
    .all() as Array<{ task_date: string; references_json: string }>);

  // Derived from the plan, not from any one record, which is why it is true on the very first day
  // and stays true however few people have signed in.
  const seen: string[] = [];
  for (const day of plan) {
    if (day.taskDate > today) continue;
    for (const reference of day.references) {
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

  return {
    books: seen,
    personDays: crowdEnough ? Math.max(0, Number(scoring.total)) : null,
    currentBook: buildBookGoal(db, plan, today),
  };
}
