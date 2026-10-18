import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(new URL('../../tools/rewards/reward-sheet.gs', import.meta.url), 'utf8');
type Cell = string | number | boolean;
type Reward = { name: string; points: number };

// In-memory Apps Script boundary: checkbox validation fills otherwise empty cells with FALSE.
// No Google services, credentials or HTTP requests are used by these tests.
class Sheet {
  readonly cells = Array.from({ length: 1000 }, () => Array<Cell>(5).fill(''));
  constructor(readonly name: string) {}
  getName() { return this.name; }
  getMaxRows() { return this.cells.length; }
  getLastRow() { return this.cells.findLastIndex((row) => row.some((cell) => cell !== '')) + 1; }
  setFrozenRows() {}
  hideSheet() {}
  getRange(rowOrA1: number | string, column = 1, height = 1, width = 1) {
    let row: number;
    if (typeof rowOrA1 === 'string') {
      const match = /^([A-E])(\d+):([A-E])(\d*)$/.exec(rowOrA1);
      if (!match) throw new Error(`Unsupported test range: ${rowOrA1}`);
      row = Number(match[2]);
      column = match[1].charCodeAt(0) - 64;
      width = match[3].charCodeAt(0) - 64 - column + 1;
      height = (match[4] ? Number(match[4]) : this.getMaxRows()) - row + 1;
    } else row = rowOrA1;
    const getValues = () => this.cells.slice(row - 1, row - 1 + height).map((cells) => cells.slice(column - 1, column - 1 + width));
    const setValues = (values: Cell[][]) => {
      values.forEach((cells, r) => cells.forEach((cell, c) => { this.cells[row - 1 + r][column - 1 + c] = cell; }));
      return range;
    };
    const range = {
      getValues, setValues,
      setValue: (value: Cell) => setValues([[value]]),
      clearContent: () => setValues(getValues().map((cells) => cells.map(() => ''))),
      setDataValidation: (rule: { checkbox?: boolean }) => {
        if (rule.checkbox) setValues(getValues().map((cells) => cells.map((cell) => cell === '' ? false : cell)));
        return range;
      },
      setFontWeight: () => range,
      setNumberFormat: () => range,
      setBackground: () => range,
      setWrap: () => range,
      merge: () => range,
    };
    return range;
  }
}

function fixture(legacyRewards: Reward[], existing?: { row: number; cells: Cell[] }) {
  const youth = new Sheet('青少獎品');
  if (existing) youth.getRange(existing.row, 1, 1, 3).setValues([existing.cells]);
  const sheets = new Map([[youth.name, youth]]);
  const book = {
    getId: () => 'fake-book',
    getSheetByName: (name: string) => sheets.get(name),
    insertSheet: (name: string) => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; },
    getSheets: () => [...sheets.values()],
  };
  const properties = new Map<string, string>();
  const propertyStore = { getProperty: (key: string) => properties.get(key), setProperty: (key: string, value: string) => properties.set(key, value) };
  const posted: Array<Record<string, { rewards: Array<{ name: string; points: number; listed: boolean }> }>> = [];
  const validation = () => {
    const rule = {
      checkbox: false,
      requireCheckbox: () => { rule.checkbox = true; return rule; },
      requireNumberGreaterThan: () => rule,
      requireDate: () => rule,
      requireValueInRange: () => rule,
      setAllowInvalid: () => rule,
      setHelpText: () => rule,
      build: () => rule,
    };
    return rule;
  };
  const trigger = {
    forSpreadsheet: () => trigger, onEdit: () => trigger, onChange: () => trigger,
    timeBased: () => trigger, everyMinutes: () => trigger, create: () => undefined,
  };
  const context = {
    DriveApp: { searchFiles: () => { let available = true; return { hasNext: () => available, next: () => { available = false; return { getId: () => 'fake-book' }; } }; } },
    SpreadsheetApp: { openById: () => book, newDataValidation: validation },
    PropertiesService: { getScriptProperties: () => propertyStore },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => trigger },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    identityToken: () => 'fake-token',
    UrlFetchApp: { fetch: (_url: string, options: { payload: string }) => {
      posted.push(JSON.parse(options.payload));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
        labels: { youth: [], main: [] }, rejected: [], legacyRewards,
        rewards: [{ name: 'Must not import this field', points: 1 }],
      }) };
    } },
  };
  runInNewContext(SCRIPT, context);
  return { youth, sheets, posted, setup: () => runInNewContext('setupRewardSheet()', context) };
}

describe('reward sheet setup', () => {
  it('imports only legacyRewards when A is empty despite a full column of FALSE checkboxes, then keeps them on repeat', () => {
    const f = fixture([{ name: '電影票', points: 120 }, { name: '飲料券', points: 50 }]);
    f.youth.getRange('C2:C').setDataValidation({ checkbox: true });
    expect(f.youth.getLastRow()).toBe(1000);
    expect(f.youth.getRange('C2:C').getValues()).toEqual(Array.from({ length: 999 }, () => [false]));
    expect(f.youth.getRange('A2:A').getValues().every(([name]) => name === '')).toBe(true);

    f.setup();

    expect(f.posted[0]).toEqual({});
    expect(f.youth.getRange(2, 1, 2, 3).getValues()).toEqual([['電影票', 120, true], ['飲料券', 50, true]]);
    expect(f.posted[1].youth.rewards).toEqual([
      { row: 2, name: '電影票', points: 120, listed: true },
      { row: 3, name: '飲料券', points: 50, listed: true },
    ]);
    expect(f.posted[1].main.rewards).toEqual([]);
    const before = f.youth.getRange('A2:C').getValues();
    f.setup();
    expect(f.youth.getRange('A2:C').getValues()).toEqual(before);
  });

  it('preserves an existing prize anywhere in A, including its points and unlisted checkbox', () => {
    const f = fixture([{ name: '電影票', points: 120 }], { row: 7, cells: ['保留獎品', 75, false] });
    f.setup();
    expect(f.youth.getRange(2, 1, 1, 3).getValues()).toEqual([['', '', false]]);
    expect(f.youth.getRange(7, 1, 1, 3).getValues()).toEqual([['保留獎品', 75, false]]);
    expect(f.posted[1].youth.rewards).toEqual([{ row: 7, name: '保留獎品', points: 75, listed: false }]);
  });

  it('leaves the prize list empty when the backend returns no legacyRewards', () => {
    const f = fixture([]);
    f.setup();
    expect(f.posted[1].youth.rewards).toEqual([]);
    expect(f.posted[1].main.rewards).toEqual([]);
  });
});
