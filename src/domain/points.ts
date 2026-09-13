export type PointEventStatus = 'COMPLETED' | 'NOT_COMPLETED';

export interface PointEvent {
  eventId: string;
  completionKey: string;
  status: PointEventStatus;
}

export interface PointPolicy {
  version: string;
  status: 'ACTIVE' | 'UNCONFIGURED';
  pointsPerCompletion: number;
  sharedGoalTarget?: number;
  seenEventIds?: string[];
}

export interface LedgerResult {
  points: number;
  applied: boolean;
  ledgerKey: string;
  reason: 'APPLIED' | 'DUPLICATE' | 'UNCONFIGURED' | 'NOT_COMPLETED';
}

export function applyPointEvent(event: PointEvent, policy: PointPolicy): LedgerResult {
  const ledgerKey = `${policy.version}:${event.eventId}`;
  if (policy.status === 'UNCONFIGURED') {
    return { points: 0, applied: false, ledgerKey, reason: 'UNCONFIGURED' };
  }
  if (event.status !== 'COMPLETED') {
    return { points: 0, applied: false, ledgerKey, reason: 'NOT_COMPLETED' };
  }
  if (policy.seenEventIds?.includes(event.eventId)) {
    return { points: 0, applied: false, ledgerKey, reason: 'DUPLICATE' };
  }
  return {
    points: Math.max(0, policy.pointsPerCompletion),
    applied: true,
    ledgerKey,
    reason: 'APPLIED',
  };
}

export function calculateNetPoints(
  events: PointEvent[],
  policy: PointPolicy,
): { points: number; completedTasks: number } {
  if (policy.status === 'UNCONFIGURED') return { points: 0, completedTasks: 0 };
  const finalStatuses = new Map<string, PointEventStatus>();
  for (const event of events) finalStatuses.set(event.completionKey, event.status);
  const completedTasks = [...finalStatuses.values()].filter((status) => status === 'COMPLETED').length;
  return {
    points: completedTasks * Math.max(0, policy.pointsPerCompletion),
    completedTasks,
  };
}
