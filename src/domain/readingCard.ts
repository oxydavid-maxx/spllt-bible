import { READING_CARD_CSS } from './readingCardStyles';

export type ReadingCardScope = 'month' | 'quarter';
export interface ReadingCardDay { date: string; rows: readonly string[]; completed: boolean; devoted: boolean; }
export interface ReadingCardInput { today: string; memberName: string; scope: ReadingCardScope; days: readonly ReadingCardDay[]; }
const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const QUARTERS = ['第一季', '第二季', '第三季', '第四季'];
const WEEKDAYS = ['一 / MON', '二 / TUE', '三 / WED', '四 / THU', '五 / FRI', '六 / SAT'];
const readings = (day: ReadingCardDay) => day.rows.map(text => text.trim()).filter(text => text && text !== '安息');
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Church card spelling; the plan's source rows already preserve 溫故 → 知新 → 詩篇. */
export function formatCardPassage(source: string): string {
  const text = source.trim().replace(/\d+/g, value => String(Number(value)))
    .replace(/(\d+)[章篇](\d+(?:-\d+)?)節$/, '$1:$2')
    .replace(/篇$/, '章');
  return text.includes(':') ? text : text.replace(/(\d)$/, '$1章');
}

export function cardPeriod(today: string, scope: ReadingCardScope) {
  const year = today.slice(0, 4), month = Number(today.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3);
  const first = quarter * 3 + 1;
  const months = (scope === 'month' ? [month] : [first, first + 1, first + 2]).map(value => `${year}-${String(value).padStart(2, '0')}`);
  return { months, monthLabel: `本月 (${month} 月)`, quarterLabel: `本季 (${first}–${first + 2} 月)`, quarterTitle: `${year} ${QUARTERS[quarter]} (${first}–${first + 2} 月)` };
}

/** 讀經卡-<名字>-202610.pdf / 讀經卡-<名字>-2026第四季.pdf: a co-worker who receives several cards can tell whose and which period. */
export function readingCardFileName(input: Pick<ReadingCardInput, 'today' | 'memberName' | 'scope'>): string {
  const year = input.today.slice(0, 4), month = Number(input.today.slice(5, 7));
  const period = input.scope === 'month' ? `${year}${String(month).padStart(2, '0')}` : `${year}${QUARTERS[Math.floor((month - 1) / 3)]}`;
  // Characters Android and iOS file names cannot hold are dropped; an empty result leaves the name out.
  const name = input.memberName.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  return `讀經卡-${name ? `${name}-` : ''}${period}.pdf`;
}

/** Complete calendar weeks, Monday–Saturday, with Sundays omitted even at the edges. */
export function cardMonthWeeks(month: string): Array<Array<string | null>> {
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = new Date(first);
  start.setUTCDate(1 - (first.getUTCDay() + 6) % 7);
  const weeks: Array<Array<string | null>> = [];
  while (start.toISOString().slice(0, 7) <= month) {
    const week = Array.from({ length: 6 }, (_, offset) => {
      const value = new Date(start);
      value.setUTCDate(start.getUTCDate() + offset);
      const date = value.toISOString().slice(0, 10);
      return date.startsWith(`${month}-`) ? date : null;
    });
    if (week.some(Boolean)) weeks.push(week);
    start.setUTCDate(start.getUTCDate() + 7);
  }
  return weeks;
}

export function cardStatistics(days: readonly ReadingCardDay[], months: readonly string[], today: string) {
  const planned = days.filter(day => months.includes(day.date.slice(0, 7)) && readings(day).length > 0);
  const elapsed = planned.filter(day => day.date <= today);
  return { planned: planned.length, elapsed: elapsed.length, missed: elapsed.filter(day => !day.completed).length };
}

export function giftMessage(missed: number): string {
  return missed < 9 ? '少於 9 天，季底可以憑卡領禮物' : '已經超過 9 天';
}

export function buildReadingCardHtml(input: ReadingCardInput): string {
  const period = cardPeriod(input.today, input.scope);
  const months = period.months.filter(month => input.days.some(day => day.date.startsWith(`${month}-`) && readings(day).length > 0));
  if (months.length === 0) throw new Error('這段期間沒有排定讀經。');
  const byDate = new Map(input.days.map(day => [day.date, day]));
  const cell = (date: string | null) => {
    const day = date ? byDate.get(date) : undefined;
    const lines = day ? readings(day).slice(0, 3) : [];
    const rows = Array.from({ length: 3 }, (_, index) => {
      const text = lines[index];
      return `<div class="r"><i${text ? ' class="box"' : ''}>${text && day?.completed ? '✔' : ''}</i><b>${text ? escape(formatCardPassage(text)) : ''}</b></div>`;
    }).join('');
    return `<td class="day${date ? '' : ' empty'}"${date ? ` data-date="${date}"` : ''}><div class="n">${date ? Number(date.slice(8)) : ''}${day?.devoted ? '<span class="dv">靈修</span>' : ''}</div><div class="rows">${rows}</div></td>`;
  };
  const monthTable = (month: string) => `<table class="month"><tr><th class="title" colspan="6"><span>${month.slice(0, 4)}年 ${MONTH_NAMES[Number(month.slice(5)) - 1]}</span><em>${escape(input.memberName)}</em></th></tr><tr class="dow">${WEEKDAYS.map(text => `<th>${text}</th>`).join('')}</tr>${cardMonthWeeks(month).map(week => `<tr>${week.map(cell).join('')}</tr>`).join('')}</table>`;
  const stats = cardStatistics(input.days, months, input.today);
  const summary = `<div class="sum"><b>${input.scope === 'month' ? MONTH_NAMES[Number(months[0].slice(5)) - 1] : `${period.quarterTitle} · ${escape(input.memberName)}`}</b><span>排定 ${stats.planned} 天，到今天 ${stats.elapsed} 天，未完成 <strong>${stats.missed}</strong> 天${input.scope === 'quarter' ? `<span class="ok">${giftMessage(stats.missed)}</span>` : ''}</span></div>`;
  const tables = months.map(monthTable).join('');
  // Some quarters contain sixteen Monday–Saturday calendar rows. Keep their total height the
  // same as the approved fifteen-row mock so the second footer stays inside A4 as months change.
  const weeks = months.reduce((count, month) => count + cardMonthWeeks(month).length, 0);
  const quarterRowMm = 13.125 * Math.min(1, 15 / weeks);
  const layout = input.scope === 'quarter' ? ` style="--quarter-day-height:${quarterRowMm}mm"` : '';
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>匯出讀經卡</title><style>${READING_CARD_CSS}</style></head><body><div class="paper ${input.scope === 'month' ? 'one' : 'quarter'}"${layout}>${input.scope === 'quarter' ? summary + tables : tables + summary}<div class="notes"><p>完成讀經，App 已在黃色格子內劃上 <span class="tick">✔</span></p><p>當季未完成日期少於9天(10%)，季底憑卡領取禮物</p></div></div></body></html>`;
}
