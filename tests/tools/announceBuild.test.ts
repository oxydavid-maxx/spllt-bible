import { describe, expect, it } from 'vitest';
import { readWeekFiles } from '../../tools/announce/build';
import { buildReviewPrompt, parseVerdict } from '../../tools/announce/review';

const WEEK = [
  { id: '1CX5pHpYDmNPN-2_9E082QikMMWPhlHtg', name: '2026-09-20 09_16_45.mp3' },
  { id: '1H87b3pGJoVPsjicbZT588hURi2839nw4', name: '20260920 先｜線上聆聽連結.pdf' },
  { id: '1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc', name: '20260920 青崇講道｜先' },
  { id: '1rWlOtjhvzH92A9kohcPysh_cLqof-pHAikgZXENgZzE', name: '20260920 青崇講道｜先｜現場逐字稿' },
  { id: '1yf5JNezk_ubEdtFD70LzPyLvqG0v7EUZUDWRW2plNPY', name: '20260920青崇(全)PPT' },
  { id: '1KTW4ZfKB_Z4-Q3SDS2PsKBNJZXS4bYc-', name: 'opening-all-want-11.8-22.mp4' },
];

describe('what a week folder yields', () => {
  it('picks the recording, the deck and the transcript out of everything else', () => {
    const files = readWeekFiles(WEEK);
    expect(files.audio).toContain('1CX5pHpYDmNPN-2_9E082QikMMWPhlHtg');
    expect(files.slides).toContain('/presentation/d/1yf5JNezk');
    expect(files.transcript).toContain('/document/d/1rWlOtjh');
  });

  it('takes the sermon title from what the file was named', () => {
    // The deck announced 《先》 while the spreadsheet still said 人違背神. The file name is what
    // was actually confirmed, so it wins.
    expect(readWeekFiles(WEEK).title).toBe('先');
  });

  it('ignores the opening videos and the listening-link pdf', () => {
    const files = readWeekFiles(WEEK);
    expect(files.audio).not.toContain('1KTW4ZfK');
    expect(files.slides).not.toContain('1H87b3pG');
  });

  it('returns a week with nothing in it as nothing, rather than as empty links', () => {
    const files = readWeekFiles([{ id: 'x', name: '未命名文件' }]);
    expect(files).toMatchObject({ title: null, audio: null, slides: null, transcript: null });
  });
});

describe('the weekly review verdict', () => {
  it('publishes on OK', () => {
    expect(parseVerdict('OK')).toEqual({ sensible: true, reason: null });
    expect(parseVerdict('ok\n')).toEqual({ sensible: true, reason: null });
  });

  it('withholds only for the three structural failures', () => {
    expect(parseVerdict('NG;FIELDS')).toEqual({ sensible: false, reason: 'FIELDS' });
    expect(parseVerdict('NG；DATE')).toEqual({ sensible: false, reason: 'DATE' });
    expect(parseVerdict('NG;WRONGTAB')).toEqual({ sensible: false, reason: 'WRONGTAB' });
  });

  // It once withheld a correct week because it thought a sermon called 《先》 was too short a title.
  // A one-character Chinese title is ordinary, and style is not what this gate is for.
  it('publishes through an opinion that is not one of those three', () => {
    const verdict = parseVerdict('NG;講道標題只有一個字「先」，明顯不完整');
    expect(verdict.sensible).toBe(true);
    expect(verdict.reason).toContain('未分類');
  });

  // One unreadable reply must not be able to block a correct announcement. The check is a second
  // opinion on data assembled from spreadsheets, not the thing that decides whether it exists.
  it('publishes anyway when the answer is not a verdict, and records that it did', () => {
    const verdict = parseVerdict('我覺得這份公告看起來還不錯耶');
    expect(verdict.sensible).toBe(true);
    expect(verdict.reason).toContain('無法判讀');
  });

  it('asks about the failures a regex cannot see', () => {
    const prompt = buildReviewPrompt({
      week: '2026-09-20', generatedAt: '', sermon: null, next: null, standing: null, past: [],
    }, '2026-09-21');
    expect(prompt).toContain('2026-09-21');
    expect(prompt).toContain('NG;FIELDS');
    expect(prompt).toContain('講道標題只有一兩個字是正常的');
  });
});
