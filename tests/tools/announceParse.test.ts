import { describe, expect, it } from 'vitest';
import {
  classifyFile, excelSerialToDate, findSignupUrl, headline, isGoogleNative, listWeekFolders,
  nextAfter, parseFolderListing, pickWeekFolder, readPlanRows, rowFor, sermonTitleFromName,
  shortDate, viewUrl,
} from '../../tools/announce/parse';

// Fixtures below are the real shapes, taken from the actual 青崇 folder and workbooks on 2026-09-21.

const LISTING = `
<div id="entry-1CX5pHpYDmNPN-2_9E082QikMMWPhlHtg" class="flip-entry">
  <div class="flip-entry-title">2026-09-20 09_16_45.mp3</div></div>
<div id="entry-1yf5JNezk_ubEdtFD70LzPyLvqG0v7EUZUDWRW2plNPY" class="flip-entry">
  <div class="flip-entry-title">20260920青崇(全)PPT</div></div>
<div id="entry-1rWlOtjhvzH92A9kohcPysh_cLqof-pHAikgZXENgZzE" class="flip-entry">
  <div class="flip-entry-title">20260920 青崇講道｜先｜現場逐字稿</div></div>
<div id="entry-1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc" class="flip-entry">
  <div class="flip-entry-title">20260920 青崇講道｜先</div></div>
<div id="entry-1Jyuh3egnIAZ68kEv3Qz-uQaYkgxS16ei" class="flip-entry">
  <div class="flip-entry-title">9月27日豚汁定食與柚子特別企劃_可愛版_v3.pdf</div></div>
`;

describe('reading the folder listing', () => {
  it('pulls out every file with its id', () => {
    const entries = parseFolderListing(LISTING);
    expect(entries).toHaveLength(5);
    expect(entries[1]).toEqual({ id: '1yf5JNezk_ubEdtFD70LzPyLvqG0v7EUZUDWRW2plNPY', name: '20260920青崇(全)PPT' });
  });

  it('returns nothing rather than guessing when the markup changes', () => {
    expect(parseFolderListing('<html><body>something else entirely</body></html>')).toEqual([]);
  });
});

describe('choosing which week to publish', () => {
  const weeks = [
    { id: 'a', name: '20260906' }, { id: 'b', name: '20260913' },
    { id: 'c', name: '20260920' }, { id: 'd', name: '20260927' },
    { id: 'e', name: 'not a week' },
  ];

  it('takes the most recent Sunday that has happened', () => {
    expect(pickWeekFolder(weeks, '2026-09-21')?.name).toBe('20260920');
  });

  it('does not publish a week that has been prepared early', () => {
    // Somebody building next Sunday on Tuesday must not overwrite the week people are still in.
    expect(pickWeekFolder(weeks, '2026-09-22')?.name).toBe('20260920');
  });

  it('is exact on the day itself', () => {
    expect(pickWeekFolder(weeks, '2026-09-27')?.name).toBe('20260927');
  });

  it('says nothing when no week has happened yet', () => {
    expect(pickWeekFolder(weeks, '2026-08-01')).toBeNull();
  });

  it('lists past weeks newest first, ignoring anything that is not a week', () => {
    expect(listWeekFolders(weeks, '2026-09-21').map((w) => w.name)).toEqual(['20260920', '20260913', '20260906']);
  });
});

describe('what each file in the folder is', () => {
  it('recognises the pieces of a Sunday', () => {
    expect(classifyFile('2026-09-20 09_16_45.mp3')).toBe('audio');
    expect(classifyFile('20260920青崇(全)PPT')).toBe('slides');
    expect(classifyFile('913健身是什麼？.pptx')).toBe('slides');
    expect(classifyFile('20260920 青崇講道｜先｜現場逐字稿')).toBe('transcript');
    expect(classifyFile('20260920 青崇講道｜先')).toBe('sermonDoc');
    expect(classifyFile('9月27日豚汁定食與柚子特別企劃_可愛版_v3.pdf')).toBe('poster');
    expect(classifyFile('opening-all-want-11.8-22.mp4')).toBe('video');
  });

  it('calls anything unexpected other, so it is simply not linked', () => {
    expect(classifyFile('未命名文件')).toBe('other');
    expect(classifyFile('隨手放的東西.zip')).toBe('other');
  });
});

describe('the link a person should be sent to', () => {
  it('opens Google files in their own viewer', () => {
    expect(viewUrl({ id: '1yf5JNezk_ubEdtFD70LzPyLvqG0v7EUZUDWRW2plNPY', name: 'x' }, 'slides'))
      .toBe('https://docs.google.com/presentation/d/1yf5JNezk_ubEdtFD70LzPyLvqG0v7EUZUDWRW2plNPY/preview');
    expect(viewUrl({ id: '1rWlOtjhvzH92A9kohcPysh_cLqof-pHAikgZXENgZzE', name: 'x' }, 'transcript'))
      .toContain('/document/d/');
  });

  it('opens an uploaded file through Drive, because there is no Google viewer for it', () => {
    // A .pptx that was uploaded rather than converted keeps a short id and is not a Slides document.
    expect(isGoogleNative('1L3714Keo6OY44cZq6lTLxW20Ss7VqWgD')).toBe(false);
    expect(viewUrl({ id: '1L3714Keo6OY44cZq6lTLxW20Ss7VqWgD', name: 'x' }, 'slides'))
      .toBe('https://drive.google.com/file/d/1L3714Keo6OY44cZq6lTLxW20Ss7VqWgD/view');
  });
});

describe('the sermon title, taken from what it was named', () => {
  it('reads it out of the file name', () => {
    expect(sermonTitleFromName('20260920 青崇講道｜先')).toBe('先');
    expect(sermonTitleFromName('20260920 青崇講道｜先｜現場逐字稿')).toBe('先');
  });

  it('gives nothing when the name does not carry one', () => {
    expect(sermonTitleFromName('20260920青崇(全)PPT')).toBeNull();
  });
});

describe('dates as the spreadsheets store them', () => {
  it('converts the serial the sheet actually contains', () => {
    // 46285 is the row the deck confirms as 9/20, 光佑, 創3.
    expect(excelSerialToDate(46285)).toBe('2026-09-20');
    expect(excelSerialToDate(46292)).toBe('2026-09-27');
  });

  it('refuses a cell that is not a date', () => {
    expect(excelSerialToDate(Number('小組長'))).toBeNull();
    expect(excelSerialToDate(0)).toBeNull();
  });

  it('says the date the way it is said out loud', () => {
    expect(shortDate('2026-09-27')).toBe('9/27');
    expect(shortDate('2026-10-04')).toBe('10/4');
  });
});

describe('the schedule rows', () => {
  const rows = [
    ['Date', 'Topic', 'Owner', 'Note'],
    ['46285', '人違背神', '光佑', '創3'],
    ['46292', '耶穌：耶穌是誰？', '中亮/大專', ''],
    ['46299', '亞當的後代', '佑駿', '創4-5'],
    ['小組長', '', '', ''],
  ];

  it('keeps the rows that are rows and drops the rest', () => {
    const plan = readPlanRows(rows);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toEqual({ date: '2026-09-20', topic: '人違背神', owner: '光佑', note: '創3' });
  });

  it('finds this week and the next one', () => {
    const plan = readPlanRows(rows);
    expect(rowFor(plan, '2026-09-20')?.owner).toBe('光佑');
    expect(nextAfter(plan, '2026-09-20')?.date).toBe('2026-09-27');
  });

  it('has no next one at the end of the plan', () => {
    expect(nextAfter(readPlanRows(rows), '2026-10-04')).toBeNull();
  });
});

describe('the sign-up link', () => {
  it('finds a form wherever it was written', () => {
    expect(findSignupUrl('報名 QR code：https://forms.gle/Z7EvQyzCVEmnQYHNA')).toBe('https://forms.gle/Z7EvQyzCVEmnQYHNA');
  });

  it('gives nothing when there is no form, rather than a half-matched url', () => {
    expect(findSignupUrl('這週沒有需要報名的活動')).toBeNull();
    expect(findSignupUrl('https://maps.app.goo.gl/k9NFs6UmogC2sGqj9')).toBeNull();
  });
});

describe('a headline out of a topic cell', () => {
  // 青年啟發 keeps the session title and its discussion questions in one cell. Used whole, a sermon
  // title became four lines of questions on the notice board.
  it('takes the title and leaves the small-group questions behind', () => {
    const cell = '生命：這就是人生嗎？\n如果只剩下24小時可以活，你想做些什麼？\n你覺得為什麼一般人會覺得討論宗教信仰很奇怪？';
    expect(headline(cell)).toBe('生命：這就是人生嗎？');
  });

  it('leaves an ordinary one-line topic alone', () => {
    expect(headline('爸媽不在家，我要活下去系列: 豚汁定食/如何殺柚子')).toBe('爸媽不在家，我要活下去系列: 豚汁定食/如何殺柚子');
  });

  it('copes with windows line endings and an empty cell', () => {
    expect(headline('耶穌：耶穌是誰？\r\n你是否親眼見過名人？')).toBe('耶穌：耶穌是誰？');
    expect(headline('')).toBe('');
  });
});

describe('the two decks of a week (光佑 2026-09-26: the 講道 deck and the 報告 deck are both linked)', () => {
  // The real listing markup, trimmed: every entry carries its file type in the list icon.
  const TYPED = '<div class="flip-entry" id="entry-1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc"><a href="https://docs.google.com/presentation/d/1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc/edit?usp=drive_web">'
    + '<div class="flip-entry-list-icon"><img src="https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.presentation" alt=""/></div>'
    + '<div class="flip-entry-title">20260920 青崇講道｜先</div></a></div>'
    + '<div class="flip-entry" id="entry-1H87b3pGJoVPsjicbZT588hURi2839nw4"><div class="flip-entry-list-icon"><img src="https://drive-thirdparty.googleusercontent.com/16/type/application/pdf" alt=""/></div>'
    + '<div class="flip-entry-title">20260920 先｜線上聆聽連結.pdf</div></div>';

  it('reads each file type from the listing', () => {
    expect(parseFolderListing(TYPED)).toEqual([
      { id: '1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc', name: '20260920 青崇講道｜先', mimeType: 'application/vnd.google-apps.presentation' },
      { id: '1H87b3pGJoVPsjicbZT588hURi2839nw4', name: '20260920 先｜線上聆聽連結.pdf', mimeType: 'application/pdf' },
    ]);
  });

  it('tells the sermon deck from the service deck and from the sermon manuscript', () => {
    expect(classifyFile('20260920 青崇講道｜先', 'application/vnd.google-apps.presentation')).toBe('sermonSlides');
    expect(classifyFile('20261004 青崇講道｜信', 'application/pdf')).toBe('sermonSlides');
    expect(classifyFile('20260920 青崇講道｜先', 'application/vnd.google-apps.document')).toBe('sermonDoc');
    expect(classifyFile('20260920青崇(全)PPT', 'application/vnd.google-apps.presentation')).toBe('slides');
    expect(classifyFile('20261004青崇(全).pdf', 'application/pdf')).toBe('slides');
    expect(classifyFile('20260920 先｜線上聆聽連結.pdf', 'application/pdf')).toBe('poster');
  });

  it('links each file the way its type opens', () => {
    expect(viewUrl({ id: '1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc', name: 'x', mimeType: 'application/vnd.google-apps.presentation' }, 'sermonSlides'))
      .toBe('https://docs.google.com/presentation/d/1Gd3wJY0JYSCSa4ahemGndSHxtcwmYIbVCF5lB0_Yfrc/preview');
    expect(viewUrl({ id: '1cuaRcYwP_RytcnXpIwyblcGNlEXuCOgS6yC_ZFM0dzI', name: '未命名文件', mimeType: 'application/vnd.google-apps.document' }, 'other'))
      .toBe('https://docs.google.com/document/d/1cuaRcYwP_RytcnXpIwyblcGNlEXuCOgS6yC_ZFM0dzI/view');
    expect(viewUrl({ id: '1H87b3pGJoVPsjicbZT588hURi2839nw4', name: 'x.pdf', mimeType: 'application/pdf' }, 'sermonSlides'))
      .toBe('https://drive.google.com/file/d/1H87b3pGJoVPsjicbZT588hURi2839nw4/view');
  });
});
