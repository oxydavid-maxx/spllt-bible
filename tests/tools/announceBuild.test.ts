import { describe, expect, it, vi } from 'vitest';

const announceIo = vi.hoisted(() => ({
  fetchDriveFile: vi.fn(),
  fetchFolderHtml: vi.fn(),
  fetchSlidesText: vi.fn(),
  fetchWorkbook: vi.fn(),
  xlsxSheetRows: vi.fn(),
}));

vi.mock('../../tools/announce/fetch', () => announceIo);
vi.mock('../../tools/announce/office', () => ({
  pptxSlideText: vi.fn(() => []),
  xlsxSheetRows: announceIo.xlsxSheetRows,
}));

import { buildAnnouncement, readWeekFiles, type Announcement } from '../../tools/announce/build';
import { dropLinksNeedingSignIn } from '../../tools/announce/linkAccess';
import { buildReviewPrompt, parseVerdict } from '../../tools/announce/review';

const WEEK = [
  { id: '1CX5pHpYDmNPN-2_9E082QikMMWPhlHtg', name: '2026-09-20 09_16_45.mp3' },
  { id: '1H87b3pGJoVPsjicbZT588hURi2839nw4', name: '20260920 先｜線上聆聽連結.pdf' },
  { id: '1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc', name: '20260920 青崇講道｜先' },
  { id: '1rWlOtjhvzH92A9kohcPysh_cLqof-pHAikgZXENgZzE', name: '20260920 青崇講道｜先｜現場逐字稿' },
  { id: '1yf5JNezk_ubEdtFD70LzPyLvqG0v7EUZUDWRW2plNPY', name: '20260920青崇(全)PPT' },
  { id: '1KTW4ZfKB_Z4-Q3SDS2PsKBNJZXS4bYc-', name: 'opening-all-want-11.8-22.mp4' },
];

function folderHtml(entries: Array<{ id: string; name: string }>): string {
  return entries.map(({ id, name }) => '<div id="entry-' + id + '"><div class="flip-entry-title">' + name + '</div></div>').join('');
}

function excelSerial(week: string): number {
  const [year, month, day] = week.split('-').map(Number);
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000;
}

type PreviousWeek = (week: string) => Announcement['past'][number] | null;
interface HistoryBuildFixture {
  weeks: string[];
  speakers?: Record<string, string>;
  unreadable?: string[];
}

function prepareHistoryBuild(fixture: HistoryBuildFixture): void {
  announceIo.fetchFolderHtml.mockReset();
  announceIo.fetchWorkbook.mockReset();
  announceIo.xlsxSheetRows.mockReset();
  announceIo.fetchSlidesText.mockReset();

  const weeks = [...fixture.weeks].sort((a, b) => b.localeCompare(a));
  const folders = [
    { id: 'current', name: '20260920' },
    ...weeks.map((week, index) => ({ id: 'past-' + index, name: week.replace(/-/g, '') })),
  ];
  announceIo.fetchFolderHtml
    .mockResolvedValueOnce(folderHtml(folders))
    .mockResolvedValueOnce(folderHtml([]));
  for (const week of weeks) {
    announceIo.fetchFolderHtml.mockResolvedValueOnce(fixture.unreadable?.includes(week)
      ? null
      : folderHtml([{ id: 'e'.repeat(44), name: week.replace(/-/g, '') + '青崇(全)PPT' }]));
  }
  announceIo.fetchWorkbook.mockResolvedValue(Buffer.from('workbook'));
  const speakerRows = Object.entries(fixture.speakers ?? {})
    .map(([week, speaker]) => [String(excelSerial(week)), speaker, '']);
  announceIo.xlsxSheetRows.mockImplementation((_workbook: Buffer, tab: string) => tab === '2026服事表'
    ? [
        ['2026竹科靈糧堂 青年崇拜/服事表'],
        ['日期', '講員', '敬拜團+詩歌'],
        ...speakerRows,
      ]
    : []);
}

async function buildHistory(
  fixture: HistoryBuildFixture,
  previousWeek?: PreviousWeek,
) {
  prepareHistoryBuild(fixture);
  return await buildAnnouncement({ today: '2026-09-20', previousWeek });
}

describe('speakers attached to history', () => {
  it('uses the dated speaker field and leaves unmatched archive weeks unknown', async () => {
    const result = await buildHistory({
      weeks: ['2026-09-13', '2026-09-06', '2025-12-13', '2025-06-14'],
      speakers: { '2026-09-06': '為潔', '2026-09-13': '中亮' },
    });

    expect(result.announcement?.past).toMatchObject([
      { week: '2026-09-13', speaker: '中亮' },
      { week: '2026-09-06', speaker: '為潔' },
      { week: '2025-12-13', speaker: null },
      { week: '2025-06-14', speaker: null },
    ]);
  });

  it('keeps a same-week last-good speaker when the history folder is readable but the schedule has no row', async () => {
    const previous = vi.fn((week: string) => ({
      week, title: null, speaker: '已核實講員', audio: null,
      slides: 'https://example.invalid/last-good-slides', transcript: null,
    }));
    const result = await buildHistory({ weeks: ['2026-09-13'] }, previous);

    expect(previous).toHaveBeenCalledWith('2026-09-13');
    expect(result.announcement?.past).toMatchObject([
      { week: '2026-09-13', speaker: '已核實講員' },
    ]);
    expect(result.announcement?.past[0].slides).toContain('/presentation/d/');
    expect(result.announcement?.past[0].slides).not.toContain('example.invalid');
  });

  it('prefers the current speaker source to cache when the history folder is readable', async () => {
    const previous = vi.fn((week: string) => ({
      week, title: null, speaker: '較舊快取講員', audio: null,
      slides: 'https://example.invalid/last-good-slides', transcript: null,
    }));
    const result = await buildHistory({
      weeks: ['2026-09-13'],
      speakers: { '2026-09-13': '目前表定講員' },
    }, previous);

    expect(result.announcement?.past).toMatchObject([
      { week: '2026-09-13', speaker: '目前表定講員' },
    ]);
    expect(previous).not.toHaveBeenCalled();
  });

  it('does not use a last-good speaker from a different week', async () => {
    const result = await buildHistory({ weeks: ['2026-09-13'] }, () => ({
      week: '2025-12-13', title: null, speaker: '錯週講員', audio: null,
      slides: 'https://example.invalid/other-week', transcript: null,
    }));

    expect(result.announcement?.past).toMatchObject([
      { week: '2026-09-13', speaker: null },
    ]);
  });

  it('prefers the dated speaker source over the last-good cache after a folder read failure', async () => {
    const result = await buildHistory({
      weeks: ['2026-09-13'],
      speakers: { '2026-09-13': '目前表定講員' },
      unreadable: ['2026-09-13'],
    }, (week) => ({
      week, title: null, speaker: '較舊快取講員', audio: 'https://example.invalid/last-good-audio',
      slides: null, transcript: null,
    }));

    expect(result.announcement?.past).toMatchObject([
      { week: '2026-09-13', speaker: '目前表定講員', audio: 'https://example.invalid/last-good-audio' },
    ]);
  });
});

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

describe('sermon decks named only with the date (光佑 2026-09-26: 9/6 and 9/13 have one, so they must be linked)', () => {
  const PRESENTATION = 'application/vnd.google-apps.presentation';
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  it('takes the week-dated deck beside the (全) deck as the sermon deck, and leaves an undated one alone', () => {
    const sep13 = readWeekFiles([
      { id: '1BfSlo8O4R80y3ew_lm72XjjrFKFDmWQbiZUQiJxVPNE', name: '20260913青崇(全)PPT', mimeType: PRESENTATION },
      { id: '1L3714Keo6OY44cZq6lTLxW20Ss7VqWgD', name: '913健身是什麼？.pptx', mimeType: PPTX },
      { id: '150KiXW32avJZFS-hUbXHiTDWYbOlNb7q', name: '岩手短宣.pptx', mimeType: PPTX },
    ], '2026-09-13');
    expect(sep13.slides).toBe('https://docs.google.com/presentation/d/1BfSlo8O4R80y3ew_lm72XjjrFKFDmWQbiZUQiJxVPNE/preview');
    expect(sep13.sermonSlides).toBe('https://drive.google.com/file/d/1L3714Keo6OY44cZq6lTLxW20Ss7VqWgD/view');

    const sep06 = readWeekFiles([
      { id: '1Dhl5vFPStKJhxDCcSAL4tNV1wCoLMGGxieIJQDnRSzQ', name: '20260906青崇(全)PPT', mimeType: PRESENTATION },
      { id: '1dAdamEveDeck000000000000000000', name: '260906 亞當與夏娃.pptx', mimeType: PPTX },
    ], '2026-09-06');
    expect(sep06.sermonSlides).toBe('https://drive.google.com/file/d/1dAdamEveDeck000000000000000000/view');
    expect(sep06.slides).toContain('1Dhl5vFPStKJhxDCcSAL4tNV1wCoLMGGxieIJQDnRSzQ');
  });

  it('keeps the (全) deck as the 報告 deck whatever order the folder lists it in', () => {
    const files = readWeekFiles([
      { id: '1dAdamEveDeck000000000000000000', name: '260906 亞當與夏娃.pptx', mimeType: PPTX },
      { id: '1Dhl5vFPStKJhxDCcSAL4tNV1wCoLMGGxieIJQDnRSzQ', name: '20260906青崇(全)PPT', mimeType: PRESENTATION },
    ], '2026-09-06');
    expect(files.slides).toContain('1Dhl5vFPStKJhxDCcSAL4tNV1wCoLMGGxieIJQDnRSzQ');
    expect(files.sermonSlides).toContain('1dAdamEveDeck000000000000000000');
  });
});

describe('both decks of a week, and links people can actually open', () => {
  it('links the sermon deck as 講道 and the whole-service deck as 報告', () => {
    const presentations = new Set(['1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc', '1yf5JNezk_ubEdtFD70LzPyLvqG0v7EUZUDWRW2plNPY']);
    const files = readWeekFiles(WEEK.map((entry) => (presentations.has(entry.id) ? { ...entry, mimeType: 'application/vnd.google-apps.presentation' } : entry)));
    expect(files.sermonSlides).toBe('https://docs.google.com/presentation/d/1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc/preview');
    expect(files.slides).toBe('https://docs.google.com/presentation/d/1yf5JNezk_ubEdtFD70LzPyLvqG0v7EUZUDWRW2plNPY/preview');
    expect(files.title).toBe('先');
  });

  it('leaves out a link that asks for a Google sign-in or is gone, keeps one it could not check, and names each', async () => {
    const announcement: Announcement = {
      week: '2026-09-20', generatedAt: '2026-09-26T00:00:00.000Z', next: null, standing: null,
      sermon: { title: '先', speaker: null, passage: null, audio: 'https://drive.google.com/file/d/open/view', slides: 'https://docs.google.com/presentation/d/locked/preview', sermonSlides: 'https://docs.google.com/presentation/d/flaky/preview', transcript: null, youtube: null },
      past: [{ week: '2026-09-13', title: null, speaker: null, audio: null, slides: 'https://docs.google.com/presentation/d/gone/preview', transcript: null }],
    };
    const warnings = await dropLinksNeedingSignIn(announcement, async (url) => (url.includes('locked') ? 'needs-sign-in' : url.includes('gone') ? 'missing' : url.includes('flaky') ? 'unknown' : 'open'));
    expect(announcement.sermon).toMatchObject({ audio: 'https://drive.google.com/file/d/open/view', slides: null, sermonSlides: 'https://docs.google.com/presentation/d/flaky/preview' });
    expect(announcement.past[0].slides).toBeNull();
    expect(warnings).toEqual([
      'LINK_NEEDS_SHARING:2026-09-20:slides:https://docs.google.com/presentation/d/locked/preview',
      'LINK_MISSING:2026-09-13:slides:https://docs.google.com/presentation/d/gone/preview',
    ]);
  });
});
