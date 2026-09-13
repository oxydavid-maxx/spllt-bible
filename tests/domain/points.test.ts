import { describe, expect, it } from 'vitest';
import { applyPointEvent, calculateNetPoints } from '../../src/domain/points';

describe('completion points', () => {
  const policy = { version: '2026-v1', status: 'ACTIVE' as const, pointsPerCompletion: 5 };

  it('deduplicates the same completion event and preserves facts when points are unconfigured', () => {
    const event = { eventId: 'event-1', completionKey: 'self/2026-09-08', status: 'COMPLETED' as const };
    expect(applyPointEvent(event, policy)).toMatchObject({ points: 5, applied: true });
    expect(applyPointEvent(event, { ...policy, seenEventIds: ['event-1'] })).toMatchObject({
      points: 0,
      applied: false,
    });
    expect(applyPointEvent(event, { version: 'draft', status: 'UNCONFIGURED', pointsPerCompletion: 5 })).toMatchObject({
      points: 0,
      applied: false,
      reason: 'UNCONFIGURED',
    });
  });

  it('counts one net completion after complete, undo, and complete again', () => {
    const events = [
      { eventId: 'e1', completionKey: 'self/2026-09-08', status: 'COMPLETED' as const },
      { eventId: 'e2', completionKey: 'self/2026-09-08', status: 'NOT_COMPLETED' as const },
      { eventId: 'e3', completionKey: 'self/2026-09-08', status: 'COMPLETED' as const },
    ];
    expect(calculateNetPoints(events, policy)).toMatchObject({ points: 5, completedTasks: 1 });
  });
});
