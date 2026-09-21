import { createClaudeCli } from '../../server/claudeCli';
import type { Announcement } from './build';

/**
 * The only model call in the whole job: one question, a few kilobytes, twice a week.
 *
 * It is a marking pass, not a writing pass. Everything in the file was assembled from a spreadsheet
 * cell or a file name, so the risk is not that a sentence reads badly — it is that a tab got renamed
 * and the job cheerfully published last term's schedule, or that a date landed a week out. Those are
 * visible to a reader and invisible to a regex.
 */

const CLI = process.env.QINGMU_CLAUDE_CLI_PATH ?? 'C:/Users/User/.local/bin/claude.exe';

export interface Verdict { sensible: boolean; reason: string | null }

/**
 * The categories are the whole design.
 *
 * Asked to judge freely, the model volunteered that a sermon titled 《先》 was "obviously
 * incomplete" and withheld a correct announcement — it had opinions about style, which is not what
 * it is for. A one-character Chinese sermon title is ordinary. So the answer space is three named
 * structural failures and nothing else: if a concern cannot be said in one of these words, it is not
 * a reason to withhold a week that was assembled from spreadsheets.
 */
export const REVIEW_CODES = ['DATE', 'FIELDS', 'WRONGTAB'] as const;

export function buildReviewPrompt(announcement: Announcement, today: string): string {
  const lines = [
    '你在檢查一份教會青少年聚會公告，它是程式從試算表和雲端資料夾自動組出來的。',
    `今天是 ${today}。`,
    '',
    '只回下面其中一行，不要加任何其他文字：',
    'OK',
    'NG;DATE — 公告的日期明顯不對，例如離今天太遠',
    'NG;FIELDS — 欄位錯位，例如講員欄放的是經文、主題欄放的是人名',
    'NG;WRONGTAB — 內容像是從別的表誤讀來的，例如主題變成一串人名',
    '',
    '不要評論文字好壞、長短或完整度。講道標題只有一兩個字是正常的。',
    '只有上面三種結構性錯誤才回 NG，其他一律回 OK。',
    '',
    JSON.stringify(announcement, null, 2),
  ];
  return lines.join('\n');
}

/** OK, one of three named failures, or an opinion — which is recorded and does not withhold. */
export function parseVerdict(raw: string): Verdict {
  const trimmed = String(raw ?? '').trim();
  if (/^ok\b/i.test(trimmed)) return { sensible: true, reason: null };

  const named = /^ng\s*[;；]\s*(DATE|FIELDS|WRONGTAB)\b/i.exec(trimmed);
  if (named) return { sensible: false, reason: named[1].toUpperCase() };

  // An NG that is not one of the three categories is an opinion, not a finding. It is recorded and
  // the week still publishes: the data came from spreadsheets, and style is not this gate's job.
  if (/^ng\b/i.test(trimmed)) return { sensible: true, reason: `未分類的意見，已略過：${trimmed.slice(0, 40)}` };

  return { sensible: true, reason: `無法判讀的回覆，已略過檢查：${trimmed.slice(0, 40)}` };
}

export async function reviewAnnouncement(
  announcement: Announcement,
  today = new Date().toISOString().slice(0, 10),
): Promise<Verdict> {
  const cli = createClaudeCli({ executable: CLI });
  try {
    return parseVerdict(await cli.invoke(buildReviewPrompt(announcement, today)));
  } catch {
    // The model being unreachable is not a reason to withhold an announcement that was assembled
    // from spreadsheets. It is a reason to say so in the log.
    return { sensible: true, reason: 'CLI_UNAVAILABLE' };
  }
}
