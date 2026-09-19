import { describe, expect, it } from 'vitest';
import { buildJournalExport, countExportableDays } from '../../src/domain/journalExport';

describe('an export is the promise that what someone writes here is theirs', () => {
  it('writes every day in order under a readable heading', () => {
    expect(buildJournalExport([
      { taskDate: '2026-09-13', body: '第二天' },
      { taskDate: '2026-09-12', body: '第一天' },
    ])).toBe('# 靈修日記\n\n## 2026年9月12日\n\n第一天\n\n## 2026年9月13日\n\n第二天\n');
  });

  it('leaves out days with nothing on them rather than emitting empty headings', () => {
    const document = buildJournalExport([
      { taskDate: '2026-09-12', body: '有寫' },
      { taskDate: '2026-09-13', body: '   ' },
      { taskDate: '2026-09-14', body: '' },
    ]);
    expect(document).not.toContain('9月13日');
    expect(document).not.toContain('9月14日');
    expect(countExportableDays([
      { taskDate: '2026-09-12', body: '有寫' },
      { taskDate: '2026-09-13', body: '  ' },
    ])).toBe(1);
  });

  // A bare title reads like the export failed, which is the one impression export must not give.
  it('says so plainly when there is nothing to take away', () => {
    expect(buildJournalExport([])).toContain('還沒有內容');
    expect(buildJournalExport([{ taskDate: '2026-09-12', body: '\n  \n' }])).toContain('還沒有內容');
  });

  it('passes the writing through untouched, including line breaks inside a day', () => {
    const body = '第一行\n\n引用的經文\n第三行';
    expect(buildJournalExport([{ taskDate: '2026-09-12', body }])).toContain(body);
  });
});
