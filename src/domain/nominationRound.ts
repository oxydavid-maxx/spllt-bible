/**
 * How long a nomination round has left, said the way somebody would say it.
 *
 * A date is not an answer to "have I still got time". Days are, and the last day is its own case:
 * 還有 1 天 reads as tomorrow when it means today.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function describeDeadline(closesAt: number, nowMs: number): string {
  if (nowMs >= closesAt) return '投票已結束';
  const days = Math.ceil((closesAt - nowMs) / DAY_MS);
  return days <= 1 ? '今天截止' : `還有 ${days} 天`;
}
