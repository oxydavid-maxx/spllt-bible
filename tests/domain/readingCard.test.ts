import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { cardMonthWeeks, cardPeriod, cardStatistics, formatCardPassage, buildReadingCardHtml, giftMessage, readingCardFileName, type ReadingCardDay } from '../../src/domain/readingCard';

const day = (date: string, rows = ['雅01章', '徒02章1-24節', '詩109'], completed = false, devoted = false): ReadingCardDay => ({ date, rows, completed, devoted });

describe('reading card file name', () => {
  it('names the PDF by member and period so a co-worker can tell several cards apart', () => {
    expect(readingCardFileName({ today: '2026-10-19', memberName: '王小明', scope: 'month' })).toBe('讀經卡-王小明-202610.pdf');
    expect(readingCardFileName({ today: '2026-10-19', memberName: '王小明', scope: 'quarter' })).toBe('讀經卡-王小明-2026第四季.pdf');
    expect(readingCardFileName({ today: '2027-02-01', memberName: 'Amy Chen', scope: 'quarter' })).toBe('讀經卡-Amy Chen-2027第一季.pdf');
  });
  it('drops characters a file name cannot hold and leaves the name out when nothing is left', () => {
    expect(readingCardFileName({ today: '2026-03-05', memberName: ' a/b:c*?"<>|\\  d\n', scope: 'month' })).toBe('讀經卡-abc d-202603.pdf');
    expect(readingCardFileName({ today: '2026-03-05', memberName: '/:*', scope: 'month' })).toBe('讀經卡-202603.pdf');
    expect(readingCardFileName({ today: '2026-03-05', memberName: '很'.repeat(60), scope: 'month' })).toBe(`讀經卡-${'很'.repeat(40)}-202603.pdf`);
  });
});

describe('church reading card', () => {
  it.each([
    ['雅01章', '雅1章'], ['徒02章1-24節', '徒2:1-24'], ['詩119篇89-176節', '詩119:89-176'],
    ['詩107-108', '詩107-108章'], ['詩109', '詩109章'], ['門', '門'],
  ])('formats %s as %s', (input, expected) => expect(formatCardPassage(input)).toBe(expected));

  it('uses six Monday–Saturday columns and blank leading/trailing slots', () => {
    const weeks = cardMonthWeeks('2026-10');
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(weeks[4]).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    expect(cardMonthWeeks('2026-09').at(-1)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', null, null, null]);
    expect(cardMonthWeeks('2026-11')[0][0]).toBe('2026-11-02'); // Sunday-only week is omitted.
    expect(cardMonthWeeks('2028-02').flat()).toContain('2028-02-29');
    expect(weeks.flat().filter(Boolean)).toHaveLength(27);
  });

  it.each([['2026-01-01', ['2026-01', '2026-02', '2026-03']], ['2026-06-30', ['2026-04', '2026-05', '2026-06']], ['2026-07-01', ['2026-07', '2026-08', '2026-09']], ['2026-12-31', ['2026-10', '2026-11', '2026-12']]])('finds calendar quarter for %s', (today, months) => {
    expect(cardPeriod(today, 'quarter').months).toEqual(months);
    expect(cardPeriod(today, 'month').months).toEqual([today.slice(0, 7)]);
  });

  it('counts only readings, includes today and excludes future misses and other months', () => {
    const days = [day('2026-10-01'), day('2026-10-17', ['門'], true), day('2026-10-18'), day('2026-10-19'), day('2026-10-20', ['', '安息']), day('2026-09-30')];
    expect(cardStatistics(days, ['2026-10'], '2026-10-18')).toEqual({ planned: 4, elapsed: 3, missed: 2 });
  });

  it('uses the exact gift messages including the strict nine-day boundary', () => {
    expect(giftMessage(8)).toBe('少於 9 天，季底可以憑卡領禮物');
    expect(giftMessage(9)).toBe('已經超過 9 天');
    expect(giftMessage(10)).toBe('已經超過 9 天');
  });

  it('ticks every nonempty row on completion, compacts rows and keeps devotion independent', () => {
    const html = buildReadingCardHtml({ today: '2026-10-18', memberName: '測試成員', scope: 'month', days: [day('2026-10-01', ['雅01章', '', '詩109'], true, true), day('2026-10-02', ['門'], false, true)] });
    const { document } = parseHTML(html);
    const completed = document.querySelector('[data-date="2026-10-01"]')!;
    expect([...completed.querySelectorAll('.r b')].map(el => el.textContent)).toEqual(['雅1章', '詩109章', '']);
    expect([...completed.querySelectorAll('.box')].map(el => el.textContent)).toEqual(['✔', '✔']);
    expect(completed.querySelector('.dv')?.textContent).toBe('靈修');
    const undone = document.querySelector('[data-date="2026-10-02"]')!;
    expect(undone.querySelector('.box')?.textContent).toBe('');
    expect(undone.querySelector('.dv')?.textContent).toBe('靈修');
    expect(document.querySelectorAll('.empty .box')).toHaveLength(0);
    expect([...document.querySelectorAll('.dow th')].map(el => el.textContent)).toEqual(['一 / MON', '二 / TUE', '三 / WED', '四 / THU', '五 / FRI', '六 / SAT']);
    expect(document.querySelector('.title')?.textContent).toBe('2026年 十月測試成員');
    expect(document.querySelector('.sum')?.textContent).toBe('十月排定 2 天，到今天 2 天，未完成 1 天');
    expect([...document.querySelectorAll('.notes p')].map(el => el.textContent)).toEqual(['完成讀經，App 已在黃色格子內劃上 ✔', '當季未完成日期少於9天(10%)，季底憑卡領取禮物']);
    expect(html).toContain('@page');
    expect(html).toContain('A4 portrait');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('prints only planned months and escapes member names and source text', () => {
    const html = buildReadingCardHtml({ today: '2026-10-18', memberName: '<script>x</script>', scope: 'quarter', days: [day('2026-10-01'), day('2026-12-01', ['<img src=x onerror=x>']), day('2026-11-01', ['安息'])] });
    const { document } = parseHTML(html);
    expect(document.querySelectorAll('table')).toHaveLength(2);
    expect(document.querySelectorAll('script,img')).toHaveLength(0);
    expect(document.querySelector('.sum b')?.textContent).toBe('2026 第四季 (10–12 月) · <script>x</script>');
    expect(document.querySelector('.sum span')?.textContent).toContain('排定 2 天，到今天 1 天，未完成 1 天');
    expect(document.querySelector('.paper')?.firstElementChild?.className).toBe('sum');
  });
});
