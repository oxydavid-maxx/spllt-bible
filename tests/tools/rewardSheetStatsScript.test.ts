import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

const SCRIPT = readFileSync(new URL('../../tools/rewards/reward-sheet.gs', import.meta.url), 'utf8');
const NOTE = '這一頁由程式每 15 分鐘自動更新，在這裡改的內容會被蓋掉。';
const HEADERS = ['名字', '每月讀經天數', '總積分', '可以換的分數', '最後一次讀經'];
const stats = { youth: [{ name: '測試青少', monthlyReadingDays: '9月20, 10月9', earnedTotal: 23, redeemableBalance: 15, lastReadingDate: '20261017 (六)' }], main: [] };

// Cell storage models range reads/writes and clearing, so a second sync can expose stale rows.
class Sheet {
  cells: unknown[][] = [];
  maxRows = 4;
  frozen = 0;
  getLastRow() { return this.cells.reduce((last, row, index) => row.some((cell) => cell !== '' && cell !== undefined) ? index + 1 : last, 0); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after: number, count: number) { this.maxRows += count; }
  setFrozenRows(rows: number) { this.frozen = rows; }
  clearContents() { this.cells = []; return this; }
  getRange(row: number, column: number, height = 1, width = 1) {
    if (row + height - 1 > this.maxRows) throw new Error('Range exceeds sheet rows');
    const range = {
      getValues: () => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => this.cells[row + y - 1]?.[column + x - 1] ?? '')),
      setValues: (values: unknown[][]) => {
        if (values.length !== height || values.some((cells) => cells.length !== width)) throw new Error('Range dimensions differ');
        values.forEach((cells, y) => cells.forEach((cell, x) => { (this.cells[row + y - 1] ??= [])[column + x - 1] = cell; }));
        return range;
      },
      setValue: (value: unknown) => { (this.cells[row - 1] ??= [])[column - 1] = value; return range; },
      clearContent: () => range.setValues(Array.from({ length: height }, () => Array(width).fill(''))),
      merge: () => range,
      breakApart: () => range,
      setFontWeight: (_value: string) => range,
      setBackground: (_value: string) => range,
      setWrap: (_value: boolean) => range,
      setNumberFormat: (_value: string) => range,
    };
    return range;
  }
}

function workbook() {
  const sheets = new Map<string, Sheet>();
  const book = { getSheetByName: (name: string) => sheets.get(name), insertSheet: (name: string) => { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; } };
  return { sheets, book };
}

describe('reward-sheet Apps Script reading statistics', () => {
  it('writes the exact note, headers and separate pages, grows sheets and clears all old rows on every rewrite', () => {
    const { sheets, book } = workbook();
    const scope = { book, stats };
    runInNewContext(`${SCRIPT}\nwriteRewardReadingStats(book, stats);`, { ...scope });
    const youth = sheets.get('青少讀經統計')!;
    const main = sheets.get('主堂讀經統計')!;
    expect(youth.cells.slice(0, 3)).toEqual([[NOTE], HEADERS, ['測試青少', '9月20, 10月9', 23, 15, '20261017 (六)']]);
    expect(main.cells.slice(0, 2)).toEqual([[NOTE], HEADERS]);
    expect(youth.frozen).toBe(2);
    runInNewContext(`${SCRIPT}\nwriteRewardReadingStats(book, { youth: Array(5).fill(stats.youth[0]), main: stats.youth });`, { ...scope });
    expect(youth.getLastRow()).toBe(7);
    expect(youth.getMaxRows()).toBeGreaterThanOrEqual(7);
    // Include a stale cell outside the five data columns.
    youth.getRange(7, 7).setValue('過期資料');
    runInNewContext(`${SCRIPT}\nwriteRewardReadingStats(book, { youth: [], main: [] });`, { ...scope });
    expect(youth.getLastRow()).toBe(2);
    expect(main.getLastRow()).toBe(2);
    expect(youth.getRange(3, 1, 5, 7).getValues().flat().every((cell) => cell === '')).toBe(true);
  });

  it('leaves sheets untouched and creates no tabs when an older backend omits statistics', () => {
    const { sheets, book } = workbook();
    const youth = book.insertSheet('青少讀經統計');
    youth.getRange(1, 1).setValue('舊資料');
    runInNewContext(`${SCRIPT}\nwriteRewardReadingStats(book, undefined);`, { book });
    expect([...sheets.keys()]).toEqual(['青少讀經統計']);
    expect(youth.cells).toEqual([['舊資料']]);
  });

  it('uses the existing sync entry to write a real isolated backend response, and still accepts an older response', async () => {
    const database = createDatabase({ filename: ':memory:', members: [{ id: 'fixture:a', displayName: '測試會員', groupId: 'g' }] });
    try {
      const api = createApiHandler({ db: database, formRegistrationKey: 'sheet-key', now: () => new Date('2026-10-18T04:00:00Z') });
      const { book, sheets } = workbook();
      for (const name of ['青少獎品', '青少兌換', '主堂獎品', '主堂兌換', '名單']) book.insertSheet(name);
      const pushed: unknown[] = [];
      // Capture the script's POST body first, then send it to the actual integration handler.
      let reply: unknown = { labels: { youth: [], main: [] }, rejected: [], legacyRewards: [] };
      let releases = 0;
      const properties = new Map([['REWARD_SHEET_ID', 'fake-book']]);
      const scope = {
        SpreadsheetApp: { openById: (id: string) => { expect(id).toBe('fake-book'); return book; } },
        LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { releases += 1; } }) },
        PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties.get(key), setProperty: (key: string, value: string) => properties.set(key, value) }) },
        identityToken: () => 'fake-identity',
        UrlFetchApp: { fetch: (_url: string, options: { payload: string }) => { pushed.push(JSON.parse(options.payload)); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(reply) }; } },
      };
      runInNewContext(`${SCRIPT}\nsyncRewardSheet();`, { ...scope });
      expect(sheets.has('青少讀經統計')).toBe(false);
      const response = await api({ method: 'POST', url: '/api/integrations/reward-sheet', headers: { 'x-qingmu-registration-key': 'sheet-key' }, body: JSON.stringify(pushed[0]) });
      expect(response.status).toBe(200);
      reply = response.body;
      runInNewContext(`${SCRIPT}\nsyncRewardSheet();`, { ...scope });
      expect(sheets.get('青少讀經統計')?.cells[2]).toEqual(['測試會員', '9月0, 10月0', 0, 0, '']);
      expect(sheets.get('主堂讀經統計')?.getLastRow()).toBe(2);
      expect(releases).toBe(2);
    } finally { database.close(); }
  });
});
