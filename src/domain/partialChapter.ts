import { ZH_TW_BOOK_NAMES } from './scriptureReference';

export interface AssignedVerseRange {
  chapterUsfm: string;
  firstVerse: number;
  lastVerse: number;
  label: string;
}

/** Whole-chapter references stay unrestricted. A range never changes the SDK chapter request. */
export function parseAssignedVerseRange(reference: string): AssignedVerseRange | null {
  const match = /^([A-Z0-9]{3})\.([1-9]\d*)\.([1-9]\d*)(?:-([1-9]\d*))?$/.exec(reference.trim().toUpperCase());
  if (!match) return null;
  const [, book, chapter, first, last = first] = match;
  const firstVerse = Number(first), lastVerse = Number(last);
  if (![Number(chapter), firstVerse, lastVerse].every(Number.isSafeInteger) || firstVerse > lastVerse) return null;
  return { chapterUsfm: `${book}.${chapter}`, firstVerse, lastVerse,
    label: `${ZH_TW_BOOK_NAMES[book] ?? book} ${chapter}:${first}${last === first ? '' : `–${last}`}` };
}

/** The SDK may combine verses (5-6) or split one verse across several units. Keep every overlap. */
export function verseOverlapsRange(value: string, range: Pick<AssignedVerseRange, 'firstVerse' | 'lastVerse'>): boolean {
  const match = /^(\d+)(?:-(\d+))?$/.exec(value);
  if (!match) return false;
  const first = Number(match[1]), last = Number(match[2] ?? match[1]);
  return first > 0 && first <= last && first <= range.lastVerse && last >= range.firstVerse;
}
