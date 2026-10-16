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

function clean(text: string): string {
  return text
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
