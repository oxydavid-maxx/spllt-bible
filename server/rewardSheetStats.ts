import type { DatabaseSync } from 'node:sqlite';
import { taipeiDate } from '../src/domain/gamificationV1';
import { latestClientInstall, type ClientInstall } from './clientInstalls';
import { congregationOf, type Congregation } from './congregation';
import { memberReadingDays } from './devotionProgress';
import { totalEarned, walletBalance } from './gamification';
import { sheetAdminMemberIds } from './sheetAdmins';

export interface RewardSheetReadingRow {
  name: string;
  monthlyReadingDays: string;
  earnedTotal: number;
  redeemableBalance: number;
  lastReadingDate: string;
  /** 管理者 (光佑 2026-10-21): from the private settings or checked in the sheet (server/sheetAdmins.ts). */
  admin: boolean;
  /** From the private settings: the sheet always shows the check and cannot take it away. */
  adminFromSettings: boolean;
  /**
   * The name was given in this very push (a newcomer, maybe taking a deleted member's freed name): a check still on
   * the sheet under it belonged to the row before, so the script writes `admin` instead of keeping that check.
   */
  newLabel: boolean;
  /** The most recently opened phone (server/clientInstalls.ts); all three blank when no app of theirs has reported. */
  phone: '' | 'iPhone' | 'Android';
  /** Store version and the end of the running OTA update, e.g. 「0.5.35 · 更新 bff271」, as 全體 (管理) shows it. */
  version: string;
  /** The Taipei day the app was last opened, e.g. 「20261021 (三)」. */
  lastOpened: string;
}
export type RewardSheetReadingStats = Record<Congregation, RewardSheetReadingRow[]>;

/** 「YYYYMMDD (週)」 for a Taipei date YYYY-MM-DD, the way the sheet writes every day. */
const dayLabel = (date: string) => `${date.replaceAll('-', '')} (${'日一二三四五六'[new Date(`${date}T12:00:00Z`).getUTCDay()]})`;

/** The 手機, 版本 and 最後打開 columns for one phone (光佑 2026-10-21); blank when it never reported. */
export function sheetClientColumns(client: Pick<ClientInstall, 'platform' | 'version' | 'updateId' | 'lastSeenDate'> | null): Pick<RewardSheetReadingRow, 'phone' | 'version' | 'lastOpened'> {
  if (!client) return { phone: '', version: '', lastOpened: '' };
  // The end of the update id, as on the account page and 全體 (管理) (tests/ui/peopleClientVersion.test.ts holds them together).
  const update = client.updateId ? ` · 更新 ${client.updateId.replace(/-/g, '').slice(-6)}` : '';
  return { phone: client.platform === 'ios' ? 'iPhone' : 'Android', version: `${client.version}${update}`, lastOpened: dayLabel(client.lastSeenDate) };
}

/**
 * Called after applyRewardSheet, so labels, redemption deductions and 管理者 checks reflect this very push.
 * `settingsAdminIds` are the administrators from the private settings (server/routes.ts); `newLabels` the labels
 * applyRewardSheet gave in this push.
 */
export function rewardSheetReadingStats(db: DatabaseSync, now: Date, settingsAdminIds: readonly string[] = [], newLabels: ReadonlySet<string> = new Set()): RewardSheetReadingStats {
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
  const fromSheet = new Set(sheetAdminMemberIds(db));
  const result: RewardSheetReadingStats = { youth: [], main: [] };
  for (const member of members) {
    const last = (latest.get(member.id) as { date: string | null }).date;
    const adminFromSettings = settingsAdminIds.includes(member.id);
    result[congregationOf(db, member.id)].push({
      name: member.label,
      monthlyReadingDays: months.map((month) => `${Number(month.slice(5))}月${memberReadingDays(db, member.id, month)}`).join(', '),
      earnedTotal: totalEarned(db, member.id),
      redeemableBalance: walletBalance(db, member.id),
      lastReadingDate: last ? dayLabel(last) : '',
      admin: adminFromSettings || fromSheet.has(member.id),
      adminFromSettings,
      newLabel: newLabels.has(member.label),
      ...sheetClientColumns(latestClientInstall(db, member.id)),
    });
  }
  for (const side of ['youth', 'main'] as const) result[side].sort((left, right) => right.earnedTotal - left.earnedTotal || left.name.localeCompare(right.name, 'zh-Hant'));
  return result;
}
