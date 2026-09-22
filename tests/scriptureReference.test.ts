import { describe, expect, it } from 'vitest';
import { ZH_TW_BOOK_ABBREVIATIONS, ZH_TW_BOOK_NAMES, bookAbbreviationZhTw, formatReferenceListZhTw, formatReferenceZhTw } from '../src/domain/scriptureReference';

// 使用者 2026-09-11: App 顯示面一律使用台灣教會慣用繁體中文簡寫。
// 內部識別 (USFM / API / 資料庫 / 同步 / 深連結) 保持原值,只改顯示。
describe('scripture reference display (zh-TW)', () => {
  it('formats the four references the requirement names exactly', () => {
    expect(formatReferenceZhTw('PSA.88')).toBe('詩88');
    expect(formatReferenceZhTw('PSA.89')).toBe('詩89');
    expect(formatReferenceZhTw('JHN.3.16')).toBe('約3:16');
    expect(formatReferenceZhTw('1CO.13.4-7')).toBe('林前13:4-7');
    expect(formatReferenceZhTw('MAT.5.1-12')).toBe('太5:1-12');
  });

  it('joins a list the way the Today card does', () => {
    expect(formatReferenceListZhTw(['PSA.88', 'PSA.89'])).toBe('詩88、詩89');
  });

  it('handles a book-only reference', () => {
    expect(formatReferenceZhTw('PSA')).toBe('詩');
    expect(formatReferenceZhTw('1CO')).toBe('林前');
  });

  it('handles number-prefixed books, which are the easiest to get wrong', () => {
    expect(formatReferenceZhTw('1SA.17.45')).toBe('撒上17:45');
    expect(formatReferenceZhTw('2KI.2')).toBe('王下2');
    expect(formatReferenceZhTw('1JN.4.8')).toBe('約一4:8');
    expect(formatReferenceZhTw('3JN.1.4')).toBe('約三1:4');
    expect(formatReferenceZhTw('2TH.3.3')).toBe('帖後3:3');
  });

  it('covers all 66 canonical books with a non-empty Chinese abbreviation', () => {
    expect(Object.keys(ZH_TW_BOOK_ABBREVIATIONS)).toHaveLength(66);
    for (const [usfm, abbrev] of Object.entries(ZH_TW_BOOK_ABBREVIATIONS)) {
      expect(usfm).toMatch(/^[0-9A-Z]{3}$/);
      expect(abbrev.length).toBeGreaterThan(0);
      // no display label may leak a Latin book code
      expect(abbrev).not.toMatch(/[A-Za-z]/);
    }
  });

  it('never leaks a raw Latin book code for a book it knows', () => {
    for (const usfm of Object.keys(ZH_TW_BOOK_ABBREVIATIONS)) {
      expect(formatReferenceZhTw(`${usfm}.1.1`)).not.toMatch(/[A-Za-z]/);
    }
  });

  it('returns an unknown book unchanged rather than inventing a name', () => {
    expect(formatReferenceZhTw('XYZ.1.1')).toBe('XYZ.1.1');
    expect(bookAbbreviationZhTw('XYZ')).toBeUndefined();
  });

  it('leaves blank and malformed input alone instead of throwing', () => {
    expect(formatReferenceZhTw('')).toBe('');
    expect(formatReferenceZhTw('   ')).toBe('   ');
    expect(formatReferenceListZhTw([])).toBe('');
  });

  it('does not mutate the canonical identifier it was given', () => {
    const canonical = '1CO.13.4-7';
    formatReferenceZhTw(canonical);
    expect(canonical).toBe('1CO.13.4-7');
  });

  it('uses a verse separator of ":" and keeps ranges intact', () => {
    expect(formatReferenceZhTw('ROM.8.28-39')).toBe('羅8:28-39');
    expect(formatReferenceZhTw('EPH.2.8')).toBe('弗2:8');
  });

  it('accepts a lowercase or mixed-case book code defensively', () => {
    expect(formatReferenceZhTw('psa.88')).toBe('詩88');
    expect(formatReferenceZhTw('Jhn.3.16')).toBe('約3:16');
  });
});

describe('書卷全名', () => {
  it('和簡寫涵蓋一模一樣的書卷,不會有一邊查得到另一邊查不到', () => {
    expect(Object.keys(ZH_TW_BOOK_NAMES).sort()).toEqual(Object.keys(ZH_TW_BOOK_ABBREVIATIONS).sort());
    expect(Object.keys(ZH_TW_BOOK_NAMES)).toHaveLength(66);
  });

  it('唸起來是一句話,不是一個代號', () => {
    expect(ZH_TW_BOOK_NAMES['1TI']).toBe('提摩太前書');
    expect(ZH_TW_BOOK_NAMES.HEB).toBe('希伯來書');
  });
});
