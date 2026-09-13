import { describe, expect, it } from 'vitest';
import { buildProgressDisplay } from '../../src/ui/progressModel';

describe('progress display denominator', () => {
  it('uses the same local completion state for complete, undo, and restart', () => {
    expect(buildProgressDisplay('COMPLETED', null)).toMatchObject({ completed: 1, target: 1, personal: 1, scope: 'local' });
    expect(buildProgressDisplay('NOT_COMPLETED', null)).toMatchObject({ completed: 0, target: 1, personal: 0, scope: 'local' });
    expect(buildProgressDisplay('UNREPORTED', null)).toMatchObject({ completed: 0, target: 1, personal: 0, scope: 'local' });
  });

  it('uses the server fixed-member denominator when the authoritative snapshot exists', () => {
    expect(buildProgressDisplay('UNREPORTED', { date: '2026-09-08', completed: 2, totalMembers: 3, members: [], personal: { status: 'COMPLETED', revision: 1, points: 5 } })).toMatchObject({ completed: 2, target: 3, personal: 1, points: 5, scope: 'group' });
  });

  it('surfaces the active policy and month-to-date personal accumulation', () => {
    expect(buildProgressDisplay('UNREPORTED', {
      date: '2026-09-08',
      completed: 1,
      totalMembers: 2,
      members: [],
      personal: { status: 'COMPLETED', revision: 1, points: 1 },
      weekly: { periodStart: '2026-09-07', periodEnd: '2026-09-08', completed: 1, target: 4, personalCompleted: 1, points: 1, personalPoints: 1, policyStatus: 'ACTIVE', policyVersion: 'fixture-week-v1', pointsPerCompletion: 1, goalTarget: 2, goalAchieved: false },
      monthly: { periodStart: '2026-09-01', periodEnd: '2026-09-08', completed: 2, target: 8, personalCompleted: 2, points: 2, personalPoints: 2, policyStatus: 'ACTIVE', policyVersion: 'fixture-week-v1', pointsPerCompletion: 1 },
      pointsPolicy: { status: 'ACTIVE', version: 'fixture-week-v1', pointsPerCompletion: 1 },
    })).toMatchObject({ points: 1, pointsStatus: 'ACTIVE', monthly: { personalCompleted: 2, points: 2 }, goalTarget: 2, goalAchieved: false });
  });
});
