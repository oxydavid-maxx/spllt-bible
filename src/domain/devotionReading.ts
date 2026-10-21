import { ZH_TW_BOOK_ABBREVIATIONS, ZH_TW_BOOK_NAMES } from './scriptureReference';

const books = Object.fromEntries(Object.entries(ZH_TW_BOOK_NAMES).flatMap(([id, name]) => [[name, id], [ZH_TW_BOOK_ABBREVIATIONS[id], id]]));
const names = Object.keys(books).sort((a, b) => b.length - a.length).join('|');
// Verses may list more after ASCII commas (「119:20,23-24」, 「113:5-7, 9」); a full-width comma is prose.
const verseRange = '\\d{1,3}(?:[-–—]\\d{1,3})?';
const reference = `(?:(${names})\\s*)?(\\d{1,3})[:：](${verseRange}(?:\\s*,\\s*${verseRange})*)`;
const leading = new RegExp(`^\\s*${reference}\\s*`, 'u');
const spokenVerses = (list: string) => list.split(/\s*,\s*/u).map(range => range.split(/[-–—]/u).map(chineseNumber).join('至')).join('、');

/** Split only the leading citation; concatenating the two parts always restores the exact input. */
export function splitDevotionReference(text: string): { reference: string; body: string } {
  const match = leading.exec(text);
  return match ? { reference: match[0], body: text.slice(match[0].length) } : { reference: '', body: text };
}

function chineseNumber(value: string): string {
  const n = Number(value), digits = '零一二三四五六七八九';
  if (n < 10) return digits[n];
  if (n < 20) return `十${n % 10 ? digits[n % 10] : ''}`;
  if (n < 100) return `${digits[Math.floor(n / 10)]}十${n % 10 ? digits[n % 10] : ''}`;
  const rest = n % 100;
  return `${digits[Math.floor(n / 100)]}百${rest ? rest < 10 ? `零${digits[rest]}` : rest < 20 ? `一${chineseNumber(String(rest))}` : chineseNumber(String(rest)) : ''}`;
}
const chapter = (id: string, n: string) => `${ZH_TW_BOOK_NAMES[id]}第${chineseNumber(n)}${id === 'PSA' ? '篇' : '章'}`;

/**
 * Words the Azure voices misread, chosen by ear on the male voice (維護者 2026-10-21): 祢 and 祂 are said as the
 * ordinary 你 and 他; the vocative 神啊 joins as 神哪 the way it is spoken; 得著 takes the Union Version's 得着.
 * Only the spoken text changes, each swap keeps the length, and 護衛著 (zhe) is left as it is.
 */
const SPOKEN_AS: ReadonlyArray<readonly [RegExp, string]> = [[/祢/gu, '你'], [/祂/gu, '他'], [/神啊/gu, '神哪'], [/得著/gu, '得着']];

function clean(text: string): string {
  return SPOKEN_AS.reduce((spoken, [word, said]) => spoken.replace(word, said), text)
    .replace(/(?:https?:\/\/|www\.)[^\s，。！？；、<>「」]+/giu, '')
    .replace(/[0-9#*]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/gu, '')
    .replace(new RegExp(`[（(]\\s*${reference}\\s*[)）]`, 'gu'), '')
    .replace(/\s+/gu, ' ');
}

/** A fresh converter per post keeps both Azure and device speech on the same reading rules. */
function reader() {
  const announced = new Set<string>();
  function prose(text: string): string {
    return clean(text)
      .replace(new RegExp(reference, 'gu'), (_all, book: string | undefined, ch: string, verses: string) =>
        `${book ? ZH_TW_BOOK_NAMES[books[book]] : ''}${chineseNumber(ch)}${book && books[book] === 'PSA' ? '篇' : '章'}${spokenVerses(verses)}節`)
      .replace(new RegExp(`(${names})\\s*(\\d{1,3})(?![\\d:：])`, 'gu'), (_all, book: string, ch: string) => {
        const id = books[book]; announced.add(id); return chapter(id, ch);
      });
  }
  return {
    prose,
    paragraph(text: string) {
      const match = leading.exec(clean(text));
      if (!match) return prose(text).trim();
      const id = match[1] ? books[match[1]] : undefined;
      const intro = id && !announced.has(id) ? `${chapter(id, match[2])}。` : '';
      if (id) announced.add(id);
      return `${intro}${prose(clean(text).slice(match[0].length)).trim()}`;
    },
  };
}

/**
 * 背誦經文 is the reading just heard, so it is shown but not read aloud (維護者 2026-10-21). The units keep their
 * numbers, which are the backend's audio indices, so older apps that still read it get the same paragraphs.
 */
const UNSPOKEN_SECTIONS = new Set(['背誦經文']);
export function isSpokenSection(heading: string): boolean {
  return !UNSPOKEN_SECTIONS.has(heading);
}

export interface DevotionSpeechUnit { section: number; paragraph: number; text: string }

export function speechUnits(post: { title: string; sections: Array<{ heading: string; paragraphs: string[] }> }): DevotionSpeechUnit[] {
  const convert = reader();
  const units: DevotionSpeechUnit[] = [];
  post.sections.forEach((section, sectionIndex) => {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      const lead = paragraphIndex === 0 ? `${sectionIndex === 0 ? `${convert.prose(post.title)}。` : ''}${convert.prose(section.heading)}。` : '';
      units.push({ section: sectionIndex, paragraph: paragraphIndex, text: `${lead}${convert.paragraph(paragraph)}` });
    });
  });
  return units;
}

/**
 * Read-along by arithmetic (維護者 2026-10-21): each unit is one Azure mp3 whose length the player reports, so the
 * piece being heard is found from the share of the audio played. A piece is a sentence or two (1–2 lines): cut at
 * 。！？；, a long one again at a comma, a short one joined to the one before. Its share of the time follows its
 * spoken characters, with a little more for each pause. Measured on two real days' audio: 41 changes, 0.44 s
 * apart on average, at most 1.4 s; every unit starts afresh, so the error never adds up.
 */
const PIECE_MAX = 38, PIECE_PART_MAX = 30, PIECE_MIN = 12, FIRST_PIECE_MIN = 8;
const length = (text: string) => [...text].length;

export function readAlongPieces(paragraph: string): string[] {
  const sentences = paragraph.match(/[^。！？；!?;]+[。！？；!?;]+[」』”"]*|[^。！？；!?;]+$/gu) ?? [paragraph];
  const pieces: string[] = [];
  for (const sentence of sentences) {
    if (length(sentence) <= PIECE_MAX) { pieces.push(sentence); continue; }
    let current = '';
    for (const part of sentence.match(/[^，、：:,]+[，、：:,]*/gu) ?? [sentence]) {
      if (current && length(current + part) > PIECE_PART_MAX) { pieces.push(current); current = part; } else current += part;
    }
    if (current) pieces.push(current);
  }
  const joined: string[] = [];
  for (const piece of pieces) { if (joined.length && length(piece) < PIECE_MIN) joined[joined.length - 1] += piece; else joined.push(piece); }
  if (joined.length > 1 && length(joined[0]) < FIRST_PIECE_MIN) joined.splice(0, 2, joined[0] + joined[1]);
  // The pieces are drawn in place of the paragraph, so anything they would lose keeps it whole.
  return joined.join('') === paragraph ? joined : [paragraph];
}

const PAUSE_WEIGHT: Record<string, number> = { '。': 3, '！': 3, '？': 3, '；': 2, '：': 1.5, '，': 1.5, '、': 1 };
function speakingWeight(text: string): number {
  return [...text].reduce((weight, ch) => weight + (PAUSE_WEIGHT[ch] ?? (/[\p{L}\p{N}]/u.test(ch) ? 1 : 0)), 0);
}

export interface ReadAlongUnit {
  pieces: string[];
  /** Where each part ends as a share of the unit's audio: the spoken title/heading first, then each piece. */
  ends: number[];
}

/** One entry per speech unit, in the same order and numbering as speechUnits. */
export function readAlongPlan(post: { title: string; sections: Array<{ heading: string; paragraphs: string[] }> }): ReadAlongUnit[] {
  const convert = reader();
  const plan: ReadAlongUnit[] = [];
  post.sections.forEach((section, sectionIndex) => {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      const lead = paragraphIndex === 0 ? `${sectionIndex === 0 ? `${convert.prose(post.title)}。` : ''}${convert.prose(section.heading)}。` : '';
      const pieces = readAlongPieces(paragraph);
      const weights = [speakingWeight(lead), ...pieces.map((piece, index) => speakingWeight(index === 0 ? convert.paragraph(piece) : convert.prose(piece)))];
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let reached = 0;
      plan.push({ pieces, ends: weights.map((weight) => total > 0 ? (reached += weight) / total : 1) });
    });
  });
  return plan;
}

/** The part heard at `share` of the unit's audio: 0 is the spoken title/heading, n ≥ 1 is piece n - 1. */
export function readAlongPart(unit: ReadAlongUnit, share: number): number {
  let part = unit.ends.findIndex((end) => share <= end);
  if (part < 0) part = unit.ends.length - 1;
  // A unit without a spoken heading (ends[0] is 0) starts at its first piece.
  return part === 0 && unit.ends[0] === 0 ? 1 : part;
}
