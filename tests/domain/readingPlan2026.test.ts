import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalReadingPlan, getInitialReadingDate } from '../../src/domain/calendar';
import { buildReadingPlan2026, planCellReferences, planDaysFromCells, type PlanCellDay } from '../../src/domain/readingPlanImport';
import { createDatabase } from '../../server/db';
import { defaultReadingDays } from '../../server/gamification';
import { createApiHandler } from '../../server/routes';
import { getScheduledReading } from '../../src/ui/readingSession';

// 光佑 gave the whole 2026 plan on 2026-09-26 (2026讀經計劃_Vr.xlsx). The app had only September, so on
// 10/1 the reader fell back to 9/1 and the server refused October completions and progress.

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const cells = read('data/source/2026-reading-plan-cells.json') as { source: { file: string; sheet: string; sha256: string }; days: PlanCellDay[] };
const september = read('data/september-2026.json') as { plan_id: string; timezone: string; days: Array<{ date: string; source_rows: string[]; references: string[] }> };
const pairs = (days: ReadonlyArray<{ date: string; references: readonly string[] }>) => days.map((day) => [day.date, day.references]);

describe('the 2026 plan from the church sheet', () => {
  it('reads every notation the sheet uses', () => {
    expect(planCellReferences('雅01章')).toEqual(['JAS.1']);
    expect(planCellReferences('徒07章1-29節')).toEqual(['ACT.7.1-29']);
    expect(planCellReferences('詩119篇89-176節')).toEqual(['PSA.119.89-176']);
    expect(planCellReferences('詩107-108')).toEqual(['PSA.107', 'PSA.108']);
    expect(planCellReferences('詩87')).toEqual(['PSA.87']);
    expect(planCellReferences('約一03章')).toEqual(['1JN.3']);
    expect(planCellReferences('門')).toEqual(['PHM.1']);
    expect(planCellReferences('約二')).toEqual(['2JN.1']);
    expect(planCellReferences('猶')).toEqual(['JUD.1']);
    expect(planCellReferences('安息')).toEqual([]);
    expect(() => planCellReferences('約')).toThrow(/no chapter/);
  });

  it('turns the sheet\'s September into exactly the September already in use', () => {
    expect(pairs(planDaysFromCells(cells.days.filter((day) => day.date.startsWith('2026-09-'))))).toEqual(pairs(september.days));
  });

  it('schedules every Monday to Saturday from 9/1 to 12/31, keeping September and its plan id', () => {
    const plan = canonicalReadingPlan;
    expect(read('data/reading-plan-2026.json')).toEqual(buildReadingPlan2026(september, cells));
    expect(plan.planId).toBe('church-2026-09');
    expect(pairs(plan.days.filter((day) => day.date.startsWith('2026-09-')))).toEqual(pairs(september.days));
    expect(plan.days).toHaveLength(105);
    expect(plan.days.filter((day) => new Date(`${day.date}T12:00:00Z`).getUTCDay() === 0)).toEqual([]);
    expect(plan.days.find((day) => day.date === '2026-10-01')?.references).toEqual(['PSA.107', 'PSA.108']);
    expect(plan.days.find((day) => day.date === '2026-10-03')?.references).toEqual(['JAS.1', 'PSA.110']);
    expect(plan.days.find((day) => day.date === '2026-12-31')?.references).toEqual(['REV.21', 'REV.22']);
    expect(getInitialReadingDate(plan, '2026-10-01')).toBe('2026-10-01');
    expect(getInitialReadingDate(plan, '2026-10-04')).toBe('2026-10-04');
    expect(getInitialReadingDate(plan, '2027-01-02')).toBe('2026-12-31');
  });

  // 2026-10-16: the pastor's 靈修 read Psalm 119:89-176 on 10/15 and 119:1-88 on 10/16, the sheet's order.
  // The 09-29 "layout slip" correction put the church out of step with him, so the app follows the sheet.
  it('follows the church sheet for Psalm 119, which is what the pastor reads (reading-plan.md 決定)', () => {
    const day = (date: string) => canonicalReadingPlan.days.find((entry) => entry.date === date);
    expect(day('2026-10-15')?.references).toEqual(['PSA.119.89-176']);
    expect(day('2026-10-16')?.references).toEqual(['PSA.119.1-88']);
    for (const date of ['2026-10-15', '2026-10-16']) {
      expect(day(date)?.note).toBeUndefined();
      // Above the 2 the correction was served at, so a server holding the correction takes the sheet back.
      expect(day(date)?.revision).toBe(3);
      expect(getScheduledReading(date)?.note).toBe(day(date)?.note);
    }
    const sheetOnly = new Map(planDaysFromCells(cells.days).map((entry) => [entry.date, entry.references]));
    const differing = canonicalReadingPlan.days.filter((entry) => sheetOnly.has(entry.date) && JSON.stringify(sheetOnly.get(entry.date)) !== JSON.stringify(entry.references)).map((entry) => entry.date);
    expect(differing).toEqual([]);
    expect(canonicalReadingPlan.days.filter((entry) => entry.note !== undefined || entry.revision !== undefined).map((entry) => entry.date)).toEqual(['2026-10-15', '2026-10-16']);
    const revisions = new Map(defaultReadingDays().map((seed) => [seed.taskDate, seed.sourceRevision]));
    expect(revisions.get('2026-10-15')).toBe(3);
    expect(revisions.get('2026-10-16')).toBe(3);
    expect(revisions.get('2026-10-14')).toBe(1);
  });
});

describe('a server that was seeded with September only', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it('gains October to December on restart, leaves September alone, and completes and reports an October day', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qm-plan-'));
    roots.push(root);
    const filename = join(root, 'qingmu.sqlite');
    const members = [{ id: 'google:self', displayName: '小明', groupId: 'A' }];
    const septemberOnly = defaultReadingDays().filter((day) => day.taskDate.startsWith('2026-09-'));
    const before = createDatabase({ filename, members, readingDays: septemberOnly });
    const septemberRows = before.db.prepare('SELECT * FROM reading_days ORDER BY task_date').all();
    before.close();

    const db = createDatabase({ filename, members });
    try {
      const rows = db.db.prepare('SELECT * FROM reading_days ORDER BY task_date').all() as Array<{ task_date: string }>;
      expect(rows).toHaveLength(105);
      expect(rows.filter((row) => row.task_date.startsWith('2026-09-'))).toEqual(septemberRows);

      const api = createApiHandler({ db, fixtureToken: 'test-token', now: () => new Date('2026-10-01T04:00:00.000Z'), scheduleDates: canonicalReadingPlan.dates });
      const headers = { authorization: 'Bearer test-token', 'x-qingmu-member-id': 'google:self' };
      const completed = await api({
        method: 'PUT',
        url: '/api/me/completions/church-2026-09/2026-10-01',
        headers,
        body: JSON.stringify({ operation_id: 'october-first', expected_revision: 0, status: 'COMPLETED' }),
      });
      expect(completed.status).toBe(200);
      const progress = await api({ method: 'GET', url: '/api/progress?date=2026-10-01', headers });
      expect(progress.status).toBe(200);
      expect(progress.body).toMatchObject({ personal: { status: 'COMPLETED' } });
    } finally {
      db.close();
    }
  });

  it('takes the sheet\'s Psalm 119 order back on restart from a server holding the 09-29 correction, once, and touches no other row', () => {
    const root = mkdtempSync(join(tmpdir(), 'qm-plan-'));
    roots.push(root);
    const filename = join(root, 'qingmu.sqlite');
    const members = [{ id: 'google:self', displayName: '小明', groupId: 'A' }];
    // Production since 2026-09-30: 10/15 and 10/16 swapped at revision 2, every other day at revision 1.
    const corrected: Record<string, string[]> = { '2026-10-15': ['PSA.119.1-88'], '2026-10-16': ['PSA.119.89-176'] };
    const before = createDatabase({ filename, members, readingDays: defaultReadingDays().map((seed) => ({ taskDate: seed.taskDate, planId: seed.planId, references: corrected[seed.taskDate] ?? seed.references })) });
    before.db.prepare("UPDATE reading_days SET source_revision = 2 WHERE task_date IN ('2026-10-15', '2026-10-16')").run();
    const rowsBefore = before.db.prepare('SELECT * FROM reading_days ORDER BY task_date').all() as Array<Record<string, unknown>>;
    before.close();

    const restarted = createDatabase({ filename, members });
    const rowsAfter = restarted.db.prepare('SELECT * FROM reading_days ORDER BY task_date').all() as Array<Record<string, unknown>>;
    restarted.close();
    const changed = rowsAfter.filter((row, index) => JSON.stringify(row) !== JSON.stringify(rowsBefore[index]));
    expect(rowsAfter).toHaveLength(rowsBefore.length);
    expect(changed.map((row) => [row.task_date, row.references_json, row.source_revision])).toEqual([
      ['2026-10-15', '["PSA.119.89-176"]', 3],
      ['2026-10-16', '["PSA.119.1-88"]', 3],
    ]);

    const again = createDatabase({ filename, members });
    try {
      expect(again.db.prepare('SELECT * FROM reading_days ORDER BY task_date').all()).toEqual(rowsAfter);
    } finally {
      again.close();
    }
  });
});
