import { describe, expect, it } from 'vitest';
import { buildWeeklyGoal } from '../../src/domain/gamification';
import { loadSeptemberPlan } from '../../src/domain/calendar';
import calendar from '../../data/september-2026.json';

describe('cooperative weekly goal', () => {
  it('combines shared reading progress with personal progress without requiring RPG statistics', () => {
    const plan = loadSeptemberPlan(calendar);
    const goal = buildWeeklyGoal(
      plan,
      [
        { memberId: 'google:self', taskDate: '2026-09-08', status: 'COMPLETED' },
        { memberId: 'google:other', taskDate: '2026-09-08', status: 'COMPLETED' },
      ],
      {
        viewerId: 'google:self',
        memberIds: ['google:self', 'google:other'],
        periodDates: ['2026-09-08'],
      },
    );

    expect(goal).toMatchObject({
      targetTasks: 2,
      sharedCompleted: 2,
      personalCompleted: 1,
      sharedRatio: 1,
      rpg: null,
    });
    expect(goal).not.toHaveProperty('prayerScore');
    expect(goal).not.toHaveProperty('attendance');
  });
});
