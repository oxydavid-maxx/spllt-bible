import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

const SCRIPT = readFileSync(new URL('../../tools/rewards/reward-sheet.gs', import.meta.url), 'utf8');
const NOTE = '這一頁由程式每 15 分鐘自動更新，在這裡改的內容會被蓋掉。只有「管理者」的勾會留著：打勾的人在 App 裡就是管理者，取消就撤銷。';
const HEADERS = ['名字', '每月讀經天數', '總積分', '可以換的分數', '最後一次讀經', '管理者', '手機', '版本', '最後打開'];
const OWNER_NOTE = '這位管理者由 App 後端的私人設定指定，在這裡取消不會撤銷。';
const ADMIN = 6;
const row = (name: string, extra: Record<string, unknown> = {}) => ({
  name, monthlyReadingDays: '9月20, 10月9', earnedTotal: 23, redeemableBalance: 15, lastReadingDate: '20261017 (六)',
  admin: false, adminFromSettings: false, phone: 'Android', version: '0.5.35 · 更新 bff271', lastOpened: '20261021 (三)', ...extra,
});
const stats = { youth: [row('測試青少')], main: [] };

// Cell storage models range reads/writes, clearing, checkboxes and notes, so a second sync can expose stale rows
// and a lost check. Real Apps Script: insertCheckboxes() sets FALSE; removeCheckboxes() clears a TRUE/FALSE value.
class Sheet {
  cells: unknown[][] = [];
  checkboxes = new Set<string>();
  notes = new Map<string, string>();
  maxRows = 4;
  frozen = 0;
  getLastRow() { return this.cells.reduce((last, cells, index) => (cells ?? []).some((cell) => cell !== '' && cell !== undefined) ? index + 1 : last, 0); }
  getLastColumn() { return this.cells.reduce<number>((last, cells) => Math.max(last, (cells ?? []).reduce<number>((end, cell, index) => (cell !== '' && cell !== undefined ? index + 1 : end), 0)), 0); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after: number, count: number) { this.maxRows += count; }
  setFrozenRows(rows: number) { this.frozen = rows; }
  clearContents() { this.cells = []; return this; }
  getRange(row: number, column: number, height = 1, width = 1) {
    if (height < 1 || width < 1) throw new Error('The number of rows and columns in the range must be at least 1');
    if (row + height - 1 > this.maxRows) throw new Error('Range exceeds sheet rows');
    const put = (r: number, c: number, value: unknown) => { (this.cells[r - 1] ??= [])[c - 1] = value; };
    const each = (visit: (key: string, r: number, c: number) => void) => {
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) visit(`${row + y},${column + x}`, row + y, column + x);
    };
    const range = {
      getValues: () => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => this.cells[row + y - 1]?.[column + x - 1] ?? '')),
      setValues: (values: unknown[][]) => {
        if (values.length !== height || values.some((cells) => cells.length !== width)) throw new Error('Range dimensions differ');
        values.forEach((cells, y) => cells.forEach((cell, x) => put(row + y, column + x, cell)));
        return range;
      },
      setValue: (value: unknown) => { put(row, column, value); return range; },
      clearContent: () => range.setValues(Array.from({ length: height }, () => Array(width).fill(''))),
      insertCheckboxes: () => { each((key, r, c) => { this.checkboxes.add(key); put(r, c, false); }); return range; },
      removeCheckboxes: () => {
        each((key, r, c) => {
          if (!this.checkboxes.delete(key)) return;
          const value = this.cells[r - 1]?.[c - 1];
          if (value === true || value === false) put(r, c, '');
        });
        return range;
      },
      setNote: (note: string) => { this.notes.set(`${row},${column}`, note); return range; },
      clearNote: () => { each((key) => { this.notes.delete(key); }); return range; },
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

const write = (book: unknown, value: unknown) => runInNewContext(`${SCRIPT}\nwriteRewardReadingStats(book, stats);`, { book, stats: value });
const column = (sheet: Sheet, index: number) => sheet.cells.slice(2).map((cells) => [cells[0], cells[index - 1]]);

/** The Apps Script environment around syncRewardSheet(); every POST body is kept and answered with `reply`. */
function harness() {
  const { sheets, book } = workbook();
  for (const name of ['青少獎品', '青少兌換', '主堂獎品', '主堂兌換', '名單']) book.insertSheet(name);
  const pushed: Array<Record<string, unknown>> = [];
  const properties = new Map([['REWARD_SHEET_ID', 'fake-book']]);
  let releases = 0;
  const state = { reply: { labels: { youth: [], main: [] }, rejected: [], legacyRewards: [] } as unknown, status: 200 };
  const scope = {
    SpreadsheetApp: { openById: (id: string) => { expect(id).toBe('fake-book'); return book; } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { releases += 1; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties.get(key), setProperty: (key: string, value: string) => properties.set(key, value) }) },
    identityToken: () => 'fake-identity',
    UrlFetchApp: { fetch: (_url: string, options: { payload: string }) => { pushed.push(JSON.parse(options.payload)); return { getResponseCode: () => state.status, getContentText: () => JSON.stringify(state.reply) }; } },
  };
  const sync = () => runInNewContext(`${SCRIPT}\nsyncRewardSheet();`, { ...scope });
  return { sheets, book, pushed, state, sync, releases: () => releases };
}

describe('reward-sheet Apps Script reading statistics', () => {
  it('writes the exact note, headers and separate pages, grows sheets and clears all old rows on every rewrite', () => {
    const { sheets, book } = workbook();
    write(book, stats);
    const youth = sheets.get('青少讀經統計')!;
    const main = sheets.get('主堂讀經統計')!;
    expect(youth.cells.slice(0, 3)).toEqual([[NOTE], HEADERS, ['測試青少', '9月20, 10月9', 23, 15, '20261017 (六)', false, 'Android', '0.5.35 · 更新 bff271', '20261021 (三)']]);
    expect(main.cells.slice(0, 2)).toEqual([[NOTE], HEADERS]);
    expect(youth.frozen).toBe(2);
    expect([...youth.checkboxes]).toEqual(['3,6']);
    write(book, { youth: Array(5).fill(stats.youth[0]), main: stats.youth });
    expect(youth.getLastRow()).toBe(7);
    expect(youth.getMaxRows()).toBeGreaterThanOrEqual(7);
    // Include a stale cell outside the nine data columns.
    youth.getRange(7, 10).setValue('過期資料');
    write(book, { youth: [], main: [] });
    expect(youth.getLastRow()).toBe(2);
    expect(main.getLastRow()).toBe(2);
    expect(youth.getRange(3, 1, 5, 10).getValues().flat().every((cell) => cell === '')).toBe(true);
    // No empty checkbox is left on a row that no longer has a person.
    expect(youth.checkboxes.size).toBe(0);
  });

  it('leaves sheets untouched and creates no tabs when an older backend omits statistics', () => {
    const { sheets, book } = workbook();
    const youth = book.insertSheet('青少讀經統計');
    youth.getRange(1, 1).setValue('舊資料');
    write(book, undefined);
    expect([...sheets.keys()]).toEqual(['青少讀經統計']);
    expect(youth.cells).toEqual([['舊資料']]);
  });
});

// 光佑 (2026-10-21): 「截圖所示，看能不能就標註在這裏面？」 The 管理者 column is the one place on these pages that a
// person writes: the rewrite every 15 minutes must keep each check with its name, even one made a moment ago.
describe('the 管理者 checkbox survives the rewrite', () => {
  it('keeps a check the backend has not seen yet, and it follows the name when the rows are re-sorted', () => {
    const { sheets, book } = workbook();
    write(book, { youth: [row('甲'), row('乙')], main: [] });
    const youth = sheets.get('青少讀經統計')!;
    expect(column(youth, ADMIN)).toEqual([['甲', false], ['乙', false]]);
    youth.getRange(4, ADMIN).setValue(true);
    write(book, { youth: [row('乙', { earnedTotal: 99 }), row('甲')], main: [] });
    expect(column(youth, ADMIN)).toEqual([['乙', true], ['甲', false]]);
    expect([...youth.checkboxes].sort()).toEqual(['3,6', '4,6']);
    youth.getRange(3, ADMIN).setValue(false);
    write(book, { youth: [row('乙', { admin: true }), row('甲')], main: [] });
    expect(column(youth, ADMIN)).toEqual([['乙', false], ['甲', false]]);
  });

  it('shows administrators the backend knows on rows the sheet does not have yet, and keeps the owner checked with a note', () => {
    const { sheets, book } = workbook();
    const value = { youth: [row('光佑', { admin: true, adminFromSettings: true }), row('長輩', { admin: true }), row('小明')], main: [] };
    write(book, value);
    const youth = sheets.get('青少讀經統計')!;
    expect(column(youth, ADMIN)).toEqual([['光佑', true], ['長輩', true], ['小明', false]]);
    expect([...youth.notes]).toEqual([['3,6', OWNER_NOTE]]);
    youth.getRange(3, ADMIN).setValue(false);
    write(book, value);
    expect(column(youth, ADMIN)[0]).toEqual(['光佑', true]);
    expect([...youth.notes]).toEqual([['3,6', OWNER_NOTE]]);
    // The note goes with the owner, not with the row.
    write(book, { youth: [row('小明'), ...value.youth.slice(0, 2)], main: [] });
    expect([...youth.notes]).toEqual([['4,6', OWNER_NOTE]]);
  });

  it('does not put a check left under a name onto a different person the backend just gave that name', () => {
    const { sheets, book } = workbook();
    write(book, { youth: [row('甲', { admin: true })], main: [] });
    const youth = sheets.get('青少讀經統計')!;
    expect(column(youth, ADMIN)).toEqual([['甲', true]]);
    // 甲 deleted their account; a newcomer named 甲 got the freed name in this very push.
    write(book, { youth: [row('甲', { newLabel: true })], main: [] });
    expect(column(youth, ADMIN)).toEqual([['甲', false]]);
  });

  it('keeps the check of a person who moves to the other page', () => {
    const { sheets, book } = workbook();
    write(book, { youth: [row('甲')], main: [] });
    sheets.get('青少讀經統計')!.getRange(3, ADMIN).setValue(true);
    write(book, { youth: [], main: [row('甲')] });
    expect(column(sheets.get('主堂讀經統計')!, ADMIN)).toEqual([['甲', true]]);
  });

  it('keeps the checks and leaves the new columns blank when an older backend sends neither', () => {
    const { sheets, book } = workbook();
    const old = (name: string) => ({ name, monthlyReadingDays: '10月1', earnedTotal: 1, redeemableBalance: 1, lastReadingDate: '' });
    write(book, { youth: [old('甲'), old('乙')], main: [] });
    const youth = sheets.get('青少讀經統計')!;
    expect(youth.cells[2]).toEqual(['甲', '10月1', 1, 1, '', false, '', '', '']);
    youth.getRange(3, ADMIN).setValue(true);
    write(book, { youth: [old('甲'), old('乙')], main: [] });
    expect(column(youth, ADMIN)).toEqual([['甲', true], ['乙', false]]);
  });

  it('sends each name with its check from both pages, and says nothing about 管理者 while a page has no such column', () => {
    const f = harness();
    // The page as the previous script left it: five columns, no 管理者.
    const before = f.book.insertSheet('青少讀經統計');
    before.getRange(1, 1).setValue('舊說明');
    before.getRange(2, 1, 1, 5).setValues([['名字', '每月讀經天數', '總積分', '可以換的分數', '最後一次讀經']]);
    before.getRange(3, 1, 1, 5).setValues([['甲', '10月1', 1, 1, '']]);
    f.sync();
    expect(f.pushed[0]).not.toHaveProperty('admins');
    write(f.book, { youth: [row('甲'), row('乙')], main: [row('丙')] });
    f.sheets.get('青少讀經統計')!.getRange(4, ADMIN).setValue(true);
    f.sheets.get('主堂讀經統計')!.getRange(3, ADMIN).setValue(true);
    f.sync();
    expect(f.pushed[1].admins).toEqual([{ name: '甲', admin: false }, { name: '乙', admin: true }, { name: '丙', admin: true }]);
    expect(f.releases()).toBe(2);
  });

  it('keeps the sheet as it was when the backend refuses the push', () => {
    const f = harness();
    write(f.book, { youth: [row('甲')], main: [] });
    const youth = f.sheets.get('青少讀經統計')!;
    youth.getRange(3, ADMIN).setValue(true);
    f.state.status = 503;
    expect(() => f.sync()).toThrow(/App 後端沒有收下：503/);
    expect(column(youth, ADMIN)).toEqual([['甲', true]]);
    expect(f.releases()).toBe(1);
  });
});

describe('the script against a real isolated backend', () => {
  it('uses the existing sync entry to write a real isolated backend response, and still accepts an older response', async () => {
    const database = createDatabase({ filename: ':memory:', members: [{ id: 'fixture:a', displayName: '測試會員', groupId: 'g' }] });
    try {
      const api = createApiHandler({ db: database, formRegistrationKey: 'sheet-key', now: () => new Date('2026-10-18T04:00:00Z') });
      const f = harness();
      f.sync();
      expect(f.sheets.has('青少讀經統計')).toBe(false);
      const response = await api({ method: 'POST', url: '/api/integrations/reward-sheet', headers: { 'x-qingmu-registration-key': 'sheet-key' }, body: JSON.stringify(f.pushed[0]) });
      expect(response.status).toBe(200);
      f.state.reply = response.body;
      f.sync();
      expect(f.sheets.get('青少讀經統計')?.cells[2]).toEqual(['測試會員', '9月0, 10月0', 0, 0, '', false, '', '', '']);
      expect(f.sheets.get('主堂讀經統計')?.getLastRow()).toBe(2);
      expect(f.releases()).toBe(2);
    } finally { database.close(); }
  });

  it('a check makes the person an administrator, unchecking revokes it, and the owner cannot be unchecked', async () => {
    const database = createDatabase({ filename: ':memory:', members: [{ id: 'fixture:owner', displayName: '光佑', groupId: 'g' }, { id: 'fixture:a', displayName: '長輩', groupId: 'g' }] });
    try {
      database.db.prepare('INSERT INTO identity_bindings VALUES(?,?,?,?)').run('google', 'owner-subject', 'fixture:owner', '2026-10-01');
      const api = createApiHandler({ db: database, fixtureToken: 'fixture', formRegistrationKey: 'sheet-key', adminGoogleSubjects: ['owner-subject'], now: () => new Date('2026-10-21T04:00:00Z') });
      const as = (memberId: string) => ({ authorization: 'Bearer fixture', 'x-qingmu-member-id': memberId });
      const isAdmin = async (memberId: string) => ((await api({ method: 'GET', url: '/api/me/profile', headers: as(memberId) })).body as { capabilities: { canViewAllScores: boolean } }).capabilities.canViewAllScores;
      // 長輩's phone reports its version (0.5.35 with an OTA update), as every request of a current app does.
      await api({ method: 'GET', url: '/api/me/profile', headers: { ...as('fixture:a'), 'x-qingmu-client-install': '0f0e0d0c-0b0a-4908-8706-050403020100', 'x-qingmu-client-platform': 'android', 'x-qingmu-client-version': '0.5.35', 'x-qingmu-client-build': '60', 'x-qingmu-client-update': '019a3c1e-7d4f-7b2e-9c41-5e8f2abff271' } });
      const f = harness();
      // One sync: the script reads the sheet and posts; the real backend answers; the script writes that answer.
      const sync = async () => {
        const sent = f.pushed.length;
        f.state.status = 599; // the first run only captures what the script would post
        expect(() => f.sync()).toThrow();
        const response = await api({ method: 'POST', url: '/api/integrations/reward-sheet', headers: { 'x-qingmu-registration-key': 'sheet-key' }, body: JSON.stringify(f.pushed[sent]) });
        expect(response.status).toBe(200);
        f.state.status = 200;
        f.state.reply = response.body;
        f.sync();
        expect(f.pushed[sent + 1]).toEqual(f.pushed[sent]);
        return f.pushed[sent];
      };
      await sync();
      const youth = f.sheets.get('青少讀經統計')!;
      const line = (name: string) => youth.cells.findIndex((cells) => cells?.[0] === name) + 1;
      const checked = (name: string) => youth.cells[line(name) - 1][ADMIN - 1];
      expect(youth.cells[line('長輩') - 1]).toEqual(['長輩', '9月0, 10月0', 0, 0, '', false, 'Android', '0.5.35 · 更新 bff271', '20261021 (三)']);
      expect(checked('光佑')).toBe(true);
      expect(await isAdmin('fixture:a')).toBe(false);

      youth.getRange(line('長輩'), ADMIN).setValue(true);
      expect((await sync()).admins).toContainEqual({ name: '長輩', admin: true });
      expect(await isAdmin('fixture:a')).toBe(true);
      expect(checked('長輩')).toBe(true);

      youth.getRange(line('長輩'), ADMIN).setValue(false);
      await sync();
      expect(await isAdmin('fixture:a')).toBe(false);
      expect(checked('長輩')).toBe(false);

      youth.getRange(line('光佑'), ADMIN).setValue(false);
      await sync();
      expect(await isAdmin('fixture:owner')).toBe(true);
      expect(checked('光佑')).toBe(true);
      expect(database.db.prepare('SELECT member_id, change FROM sheet_admin_changes ORDER BY change_id').all()).toEqual([
        { member_id: 'fixture:a', change: 'grant' }, { member_id: 'fixture:a', change: 'revoke' },
      ]);
    } finally { database.close(); }
  });
});
