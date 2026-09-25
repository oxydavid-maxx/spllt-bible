import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// The Apps Script in 光佑's Google account reads the church sign-up form and posts names and dates.
// The real form (青崇報名表) asks 「參加日期 （可複選）」 as a grid: each row is a gathering date and the
// answer is 用餐 / 不用餐, so the date lives in the row title, not in the answer.

const SCRIPT = readFileSync(new URL('../../tools/registrations/sync-form-registrations.gs', import.meta.url), 'utf8');

type Answer = string | Array<string | null> | Array<string[] | null>;
interface Question { title: string; type: string; rows?: string[] }

function syncWith(questions: Question[], answers: Array<Record<string, Answer>>): { responses: Array<{ name: string; dates: string[] }> } {
  const posted: string[] = [];
  const items = questions.map((question) => ({
    getTitle: () => question.title,
    getType: () => question.type,
    asGridItem: () => ({ getRows: () => question.rows ?? [] }),
    asCheckboxGridItem: () => ({ getRows: () => question.rows ?? [] }),
  }));
  const form = {
    getItems: () => items,
    getResponses: () => answers.map((row) => ({
      getResponseForItem: (item: { getTitle: () => string }) => {
        const answer = row[item.getTitle()];
        return answer === undefined ? null : { getResponse: () => answer };
      },
    })),
  };
  let listed = false;
  runInNewContext(`${SCRIPT}\nsyncRegistrations();`, {
    DriveApp: { searchFiles: () => ({ hasNext: () => !listed, next: () => { listed = true; return { getId: () => 'form-1' }; } }) },
    FormApp: { openById: () => form, ItemType: { GRID: 'GRID', CHECKBOX_GRID: 'CHECKBOX_GRID', TEXT: 'TEXT', LIST: 'LIST', CHECKBOX: 'CHECKBOX' } },
    UrlFetchApp: { fetch: (_url: string, options: { payload: string }) => { posted.push(options.payload); return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' }; } },
    ScriptApp: { getIdentityToken: () => 'identity-token' },
    console: { log: () => undefined },
  });
  expect(posted).toHaveLength(1);
  return JSON.parse(posted[0]);
}

const NAME = { title: '姓名(全名)', type: 'TEXT' };
const GRADE = { title: '年級/年齡', type: 'LIST' };
const LINE = { title: 'LINE ID', type: 'TEXT' };

describe('sign-up form sync script', () => {
  it('reads the date from the grid row a respondent answered, with or without a meal, and never sends LINE IDs', () => {
    const dates = { title: '參加日期 （可複選）', type: 'GRID', rows: ['9月27日 (週日)'] };
    const payload = syncWith([NAME, GRADE, LINE, dates], [
      { '姓名(全名)': '林光佑', '年級/年齡': '社青', 'LINE ID': 'line-id-one', '參加日期 （可複選）': ['用餐'] },
      { '姓名(全名)': '陳小華', '年級/年齡': '高中', 'LINE ID': 'line-id-two', '參加日期 （可複選）': ['不用餐'] },
    ]);
    expect(payload.responses).toEqual([
      { name: '林光佑', dates: ['9月27日 (週日)'] },
      { name: '陳小華', dates: ['9月27日 (週日)'] },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/line-id|社青|高中/);
  });

  it('keeps only the grid rows that were answered, and skips someone who answered none', () => {
    const dates = { title: '參加日期', type: 'GRID', rows: ['9月27日 (週日)', '10月4日 (週日)'] };
    const payload = syncWith([NAME, dates], [
      { '姓名(全名)': '林光佑', '參加日期': ['用餐', null] },
      { '姓名(全名)': '王美美', '參加日期': [null, null] },
    ]);
    expect(payload.responses).toEqual([{ name: '林光佑', dates: ['9月27日 (週日)'] }]);
  });

  it('reads checkbox grids the same way', () => {
    const dates = { title: '參加日期', type: 'CHECKBOX_GRID', rows: ['9月27日 (週日)', '10月4日 (週日)'] };
    const payload = syncWith([NAME, dates], [{ '姓名(全名)': '林光佑', '參加日期': [[], ['用餐', '不用餐']] }]);
    expect(payload.responses).toEqual([{ name: '林光佑', dates: ['10月4日 (週日)'] }]);
  });

  it('still takes the chosen options when the dates are a plain checkbox question', () => {
    const dates = { title: '參加日期', type: 'CHECKBOX' };
    const payload = syncWith([NAME, dates], [{ '姓名(全名)': '林光佑', '參加日期': ['9/27（六）', '10/4（六）'] }]);
    expect(payload.responses).toEqual([{ name: '林光佑', dates: ['9/27（六）', '10/4（六）'] }]);
  });
});
