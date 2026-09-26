import { ZH_TW_BOOK_ABBREVIATIONS } from './scriptureReference';

/**
 * One date of the church's 2026 plan sheet (2026讀經計劃_Vr.xlsx, tab 讀經規劃-by月) as
 * data/source/2026-reading-plan-cells.json keeps it: review is 溫故, fresh is 知新, psalm is the
 * unlabeled row under 知新.
 */
export interface PlanCellDay {
  date: string;
  weekday: string;
  review: string;
  fresh: string;
  psalm: string;
}

export interface PlanFileDay {
  date: string;
  source_rows: string[];
  references: string[];
}

export interface PlanFile {
  plan_id: string;
  timezone: string;
  source: string;
  days: PlanFileDay[];
}

const BOOK_BY_ABBREVIATION = new Map(Object.entries(ZH_TW_BOOK_ABBREVIATIONS).map(([usfm, abbreviation]) => [abbreviation, usfm]));
// Longest first, so 約一 reads as 1 John rather than John.
const ABBREVIATIONS = [...BOOK_BY_ABBREVIATION.keys()].sort((left, right) => right.length - left.length);
const ONE_CHAPTER_BOOKS = new Set(['OBA', 'PHM', '2JN', '3JN', 'JUD']);

/** One sheet cell in USFM: 雅01章 → JAS.1, 徒07章1-29節 → ACT.7.1-29, 詩119篇1-88節 → PSA.119.1-88, 詩103-104 → PSA.103 and PSA.104, 門 → PHM.1. */
export function planCellReferences(cell: string): string[] {
  const text = cell.trim();
  if (text === '' || text === '安息') return [];
  const abbreviation = ABBREVIATIONS.find((candidate) => text.startsWith(candidate));
  const book = abbreviation === undefined ? undefined : BOOK_BY_ABBREVIATION.get(abbreviation);
  if (abbreviation === undefined || book === undefined) throw new Error(`plan cell names no known book: ${cell}`);
  const rest = text.slice(abbreviation.length);
  if (rest === '') {
    if (!ONE_CHAPTER_BOOKS.has(book)) throw new Error(`plan cell has no chapter: ${cell}`);
    return [`${book}.1`];
  }
  const chapter = /^(\d+)[章篇]?$/.exec(rest);
  if (chapter) return [`${book}.${Number(chapter[1])}`];
  const verses = /^(\d+)[章篇](\d+)-(\d+)節$/.exec(rest);
  if (verses) return [`${book}.${Number(verses[1])}.${Number(verses[2])}-${Number(verses[3])}`];
  const chapters = /^(\d+)-(\d+)[章篇]?$/.exec(rest);
  if (chapters && Number(chapters[1]) < Number(chapters[2])) {
    const first = Number(chapters[1]);
    return Array.from({ length: Number(chapters[2]) - first + 1 }, (_, index) => `${book}.${first + index}`);
  }
  throw new Error(`plan cell is not in a known form: ${cell}`);
}

/** The sheet's reading days in its own order (溫故, 知新, then the psalm), leaving out 安息 and empty dates. */
export function planDaysFromCells(days: readonly PlanCellDay[]): PlanFileDay[] {
  return days.flatMap((day) => {
    const rows = [day.review, day.fresh, day.psalm].map((cell) => cell.trim()).filter((cell) => cell !== '' && cell !== '安息');
    return rows.length === 0 ? [] : [{ date: day.date, source_rows: rows, references: rows.flatMap(planCellReferences) }];
  });
}

/**
 * data/reading-plan-2026.json: September exactly as it has been in use, then the sheet from October on.
 * The plan id stays church-2026-09 because completions, progress and journal entries are keyed by it;
 * it names the plan that started in September. The sheet's January to August predate the app and are
 * left out, so they cannot show up as books the church read together.
 */
export function buildReadingPlan2026(
  september: { plan_id: string; timezone: string; days: PlanFileDay[] },
  cells: { source: { file: string; sheet: string; sha256: string }; days: readonly PlanCellDay[] },
): PlanFile {
  return {
    plan_id: september.plan_id,
    timezone: september.timezone,
    source: `2026-09: data/september-2026.json; from 2026-10: ${cells.source.file} (${cells.source.sheet}) sha256 ${cells.source.sha256}`,
    days: [
      ...september.days.map(({ date, source_rows, references }) => ({ date, source_rows, references })),
      ...planDaysFromCells(cells.days.filter((day) => day.date > '2026-09-30')),
    ],
  };
}
