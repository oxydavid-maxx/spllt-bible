import { taipeiDate } from './gamificationV1';

/**
 * How long a nomination round has left, said the way somebody would say it.
 *
 * A date alone is not an answer to "have I still got time". Days are, and the last day is its own
 * case: 還有 1 天 reads as tomorrow when it means today. 光佑 2026-09-27: a bare 「還有 9 天」 did not
 * say what the days were for or which day ends them, so the line names voting and the last day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function describeDeadline(closesAt: number, nowMs: number): string {
  if (nowMs >= closesAt) return '投票已結束';
  const days = Math.ceil((closesAt - nowMs) / DAY_MS);
  if (days <= 1) return '投票今天截止';
  // The last day one can still vote: a round closing at 00:00 ends the day before.
  const [, month, day] = taipeiDate(new Date(closesAt - 1)).split('-');
  return `投票還有 ${days} 天（${Number(month)}/${Number(day)} 截止）`;
}
