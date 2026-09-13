import type { ProgressSnapshot } from '../services/apiClient';

export function buildProgressDisplay(status: 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED', remote: ProgressSnapshot | null) {
  if (remote) {
    const weekly = remote.weekly;
    return {
      completed: weekly?.completed ?? remote.completed,
      target: weekly?.target ?? remote.totalMembers,
      personal: weekly?.personalCompleted ?? (remote.personal?.status === 'COMPLETED' ? 1 : 0),
      points: weekly?.points ?? remote.personal?.points ?? 0,
      pointsStatus: weekly?.policyStatus ?? remote.pointsPolicy?.status ?? 'UNCONFIGURED',
      monthly: remote.monthly ? {
        completed: remote.monthly.completed,
        target: remote.monthly.target,
        personalCompleted: remote.monthly.personalCompleted,
        points: remote.monthly.personalPoints,
        periodStart: remote.monthly.periodStart,
        periodEnd: remote.monthly.periodEnd,
      } : undefined,
      goalTarget: weekly?.goalTarget,
      goalAchieved: weekly?.goalAchieved,
      scope: 'group' as const,
    };
  }
  const completed = status === 'COMPLETED' ? 1 : 0;
  return { completed, target: 1, personal: completed, points: 0, pointsStatus: 'UNCONFIGURED' as const, monthly: undefined, goalTarget: undefined, goalAchieved: undefined, scope: 'local' as const };
}
