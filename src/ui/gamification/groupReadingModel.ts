import type { GroupPrizeProgress, GroupReading } from '../../services/devotionClient';

/** 0 = nobody shown (fewer than two), 1–3 = light to dark by the month's busiest day. */
export type ReadersLevel = 0 | 1 | 2 | 3;

export function readersLevel(readers: number | null, busiest: number): ReadersLevel {
  if (readers === null || readers <= 0 || busiest <= 0) return 0;
  const ratio = readers / busiest;
  return ratio >= 0.7 ? 3 : ratio >= 0.45 ? 2 : 1;
}

export function monthName(month: string): string {
  return `${Number(month.slice(5, 7))} 月`;
}

const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 「10 月到今天一起讀了 184 人次，最多的一天 19 人 (10/12)」; past months drop 「到今天」. */
export function monthSummary(view: GroupReading): { lead: string; reads: string; middle: string; busiest: string | null; tail: string } | null {
  if (view.monthReads === 0) return null;
  const current = view.month === view.today.slice(0, 7);
  return {
    lead: `${monthName(view.month)}${current ? '到今天' : ''}一起讀了 `,
    reads: String(view.monthReads),
    middle: view.busiest ? ' 人次，最多的一天 ' : ' 人次',
    busiest: view.busiest ? String(view.busiest.readers) : null,
    tail: view.busiest ? ` 人 (${shortDate(view.busiest.date)})` : '',
  };
}

/** The line under the first unfinished prize: what one more member's fifteen days would mean. */
export function myPrizeLine(myDays: number, qualifyingDays: number): string {
  return myDays >= qualifyingDays
    ? `你這個月已讀滿 ${qualifyingDays} 天，算你一份`
    : `你這個月讀了 ${myDays} 天，再 ${qualifyingDays - myDays} 天就算你一份`;
}

export function prizeRule(prize: GroupPrizeProgress, qualifyingDays: number, first: boolean): string {
  return first
    ? `${prize.members} 人都讀滿一個月 (當月讀經 ${qualifyingDays} 天)，累積 ${prize.months} 個月`
    : `${prize.members} 人都讀滿一個月，累積 ${prize.months} 個月`;
}

export function prizeProgress(prize: GroupPrizeProgress): number {
  return Math.max(0, Math.min(1, prize.qualifiedThisMonth / prize.members));
}
