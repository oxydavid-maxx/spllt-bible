import type { CompletionStatus, ReadingPlan } from './types';

export interface CompletionFact {
  memberId: string;
  taskDate: string;
  status: CompletionStatus;
}

export interface WeeklyGroupSnapshot {
  viewerId: string;
  memberIds: string[];
  periodDates?: string[];
  rpg?: {
    openChatUrl: string;
    callUrl?: string;
    callProvider?: 'meet' | 'zoom';
  };
}

export interface WeeklyGoal {
  periodDates: string[];
  targetTasks: number;
  sharedCompleted: number;
  personalCompleted: number;
  sharedRatio: number;
  rpg: WeeklyGroupSnapshot['rpg'] | null;
}

export function buildWeeklyGoal(
  plan: ReadingPlan,
  completions: CompletionFact[],
  groupSnapshot: WeeklyGroupSnapshot,
): WeeklyGoal {
  const periodDates = groupSnapshot.periodDates ?? plan.dates.slice(0, 7);
  const period = new Set(periodDates);
  const members = new Set(groupSnapshot.memberIds);
  const completed = completions.filter(
    (fact) => fact.status === 'COMPLETED' && period.has(fact.taskDate) && members.has(fact.memberId),
  );
  const uniqueTasks = new Set(completed.map((fact) => `${fact.memberId}:${fact.taskDate}`));
  const personalTasks = new Set(
    completed.filter((fact) => fact.memberId === groupSnapshot.viewerId).map((fact) => fact.taskDate),
  );
  const targetTasks = periodDates.length * Math.max(1, members.size);

  return {
    periodDates,
    targetTasks,
    sharedCompleted: uniqueTasks.size,
    personalCompleted: personalTasks.size,
    sharedRatio: targetTasks === 0 ? 0 : uniqueTasks.size / targetTasks,
    rpg: groupSnapshot.rpg ?? null,
  };
}
