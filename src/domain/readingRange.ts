/**
 * Half-chapter days (maintainer 2026-10-01/02). Some plan days read part of a chapter, such as
 * PSA.119.1-88. The reader still shows the whole chapter; it opens at the range's first verse, greys the
 * rest, narrates only the range and offers 完成今日讀經 at its last verse. docs/features/reader.md.
 */

export interface ReadingRange {
  /** The chapter the range is in, BOOK.CHAPTER. */
  chapterUsfm: string;
  first: number;
  last: number;
}

const VERSES = /^([0-9A-Z]{3})\.(\d+)\.(\d+)(?:-(\d+))?$/;

/** The verses a plan reference reads inside its chapter; null for a whole chapter or an unreadable reference. */
export function readingRangeOf(reference: string): ReadingRange | null {
  const match = VERSES.exec(reference.trim().toUpperCase());
  if (!match) return null;
  const first = Number(match[3]);
  const last = Number(match[4] ?? match[3]);
  if (first < 1 || last < first) return null;
  return { chapterUsfm: `${match[1]}.${Number(match[2])}`, first, last };
}

/**
 * The day's references as the reader's tags. Two pieces of one chapter that follow each other (10/23:
 * 徒2:1-24 then 徒2:25-47) are one tag, so the chapter is read and narrated once. When the joined
 * passage starts at verse 1 it is the whole chapter: the church's sheet only splits a chapter into a
 * first and a second half (tests/domain/readingRange.test.ts checks this for the 2026 plan). The
 * calendar and the plan list keep the plan's own references.
 */
export function readerSegments(references: readonly string[]): string[] {
  const segments: string[] = [];
  let open: ReadingRange | null = null;
  for (const reference of references) {
    const range = readingRangeOf(reference);
    const joined: ReadingRange | null = open && range && range.chapterUsfm === open.chapterUsfm && range.first === open.last + 1
      ? { chapterUsfm: open.chapterUsfm, first: open.first, last: range.last } : null;
    if (joined) {
      open = joined;
      segments[segments.length - 1] = joined.first === 1 ? joined.chapterUsfm : `${joined.chapterUsfm}.${joined.first}-${joined.last}`;
      continue;
    }
    open = range;
    segments.push(reference);
  }
  return segments;
}
