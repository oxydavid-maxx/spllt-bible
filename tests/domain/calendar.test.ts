import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAdjacentScheduledDates, getInitialReadingDate, loadSeptemberPlan } from '../../src/domain/calendar';

const calendar = JSON.parse(
  await readFile(join(process.cwd(), 'data', 'september-2026.json'), 'utf8'),
);

describe('September reading calendar', () => {
  it('preserves the 9/1 verse range, repeated chapters, and Sunday gaps', () => {
    const plan = loadSeptemberPlan(calendar);
    const first = plan.days[0];

    expect(plan.days).toHaveLength(26);
    expect(first).toMatchObject({
      date: '2026-09-01',
      sourceRows: ['約12:27-50', '約13章'],
      references: ['JHN.12.27-50', 'JHN.13'],
    });
    expect(plan.days[1].references).toContain('JHN.13');
    expect(plan.dates).not.toContain('2026-09-06');
    expect(plan.dates).not.toContain('2026-09-13');
    expect(plan.uniqueReferences).toHaveLength(42);
  });

  it('keeps an unscheduled September day visible so the UI can explain that there is no task', () => {
    expect(getInitialReadingDate(loadSeptemberPlan(calendar), '2026-09-13')).toBe('2026-09-13');
    expect(getAdjacentScheduledDates(loadSeptemberPlan(calendar), '2026-09-13')).toEqual({ previous: '2026-09-12', next: '2026-09-14' });
  });
});
