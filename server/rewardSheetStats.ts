import type { DatabaseSync } from 'node:sqlite';
import { taipeiDate } from '../src/domain/gamificationV1';
import { congregationOf, type Congregation } from './congregation';
import { memberReadingDays } from './devotionProgress';
import { totalEarned, walletBalance } from './gamification';

export interface RewardSheetReadingRow {
  name: string;
  monthlyReadingDays: string;
  earnedTotal: number;
  redeemableBalance: number;
  lastReadingDate: string;
}
export type RewardSheetReadingStats = Record<Congregation, RewardSheetReadingRow[]>;

/** Called after applyRewardSheet, so labels and redemption deductions reflect this very push. */
export function rewardSheetReadingStats(db: DatabaseSync, now: Date): RewardSheetReadingStats {
  const currentMonth = taipeiDate(now).slice(0, 7);
  const months: string[] = [];
  for (let month = '2026-09'; month <= currentMonth;) {
    months.push(month);
    const [year, value] = month.split('-').map(Number);
    month = new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 7);
  }
  const members = db.prepare(`SELECT m.id, l.label FROM members m JOIN member_sheet_labels l ON l.member_id = m.id
    WHERE m.disabled_at IS NULL OR m.disabled_at = 0`).all() as Array<{ id: string; label: string }>;
  const latest = db.prepare("SELECT MAX(task_date) AS date FROM completions WHERE member_id = ? AND status = 'COMPLETED'");
  const result: RewardSheetReadingStats = { youth: [], main: [] };
  for (const member of members) {
    const last = (latest.get(member.id) as { date: string | null }).date;
    result[congregationOf(db, member.id)].push({
      name: member.label,
      monthlyReadingDays: months.map((month) => `${Number(month.slice(5))}月${memberReadingDays(db, member.id, month)}`).join(', '),
      earnedTotal: totalEarned(db, member.id),
      redeemableBalance: walletBalance(db, member.id),
      lastReadingDate: last ? `${last.replaceAll('-', '')} (${'日一二三四五六'[new Date(`${last}T12:00:00Z`).getUTCDay()]})` : '',
    });
  }
  for (const side of ['youth', 'main'] as const) result[side].sort((left, right) => right.earnedTotal - left.earnedTotal || left.name.localeCompare(right.name, 'zh-Hant'));
  return result;
}
