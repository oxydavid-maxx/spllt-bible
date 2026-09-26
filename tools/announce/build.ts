import { fetchDriveFile, fetchFolderHtml, fetchSlidesText, fetchWorkbook } from './fetch';
import { pptxSlideText, xlsxSheetRows } from './office';
import {
  classifyFile, findSignupUrl, isGoogleNative, listWeekFolders, nextAfter, parseFolderListing,
  excelSerialToDate, headline, pickWeekFolder, readPlanRows, rowFor, sermonTitleFromName, shortDate, viewUrl,
  type DriveEntry, type PlanRow,
} from './parse';

/**
 * The announcement the phone reads, built once a week from what is already in Drive.
 *
 * Nothing here interprets a slide to learn a fact a spreadsheet states. The deck is consulted for
 * exactly one thing — a sign-up link, which lives nowhere else — and otherwise the folder is used
 * as a list of files and the workbooks as tables. That is what keeps the whole job free.
 */

export const PARENT_FOLDER = '1eAVlDzcgbJYurIrSzSGBH59-HVDSdFmc';
export const PROGRAM_WORKBOOK = '1CNsEhyNwxZ5enGR4ACsr3U56Zgc8nHGOQK7Z_RU5XfU';
export const SUNDAY_WORKBOOK = '1XVzcYvDzIum-HEjuFWwVBJ9_ZphV4sFy3p-xneQSScU';

/** Tabs the job reads. A tab that has been renamed simply yields nothing, and its block disappears. */
const SERMON_TABS = ['中亮第一三周信息排班', '中亮第二四周青年啟發內容'];
const GATHERING_TABS = ['正慧姐青崇一三周第二堂規劃', '小丁第二四周第二堂'];
const STANDING_TAB = '常設';

const PAST_WEEKS = 8;

export interface SermonBlock {
  title: string | null;
  speaker: string | null;
  passage: string | null;
  audio: string | null;
  /** The whole-service deck, shown as 報告投影片. */
  slides: string | null;
  /** The sermon's own deck, shown as 講道投影片. */
  sermonSlides?: string | null;
  transcript: string | null;
  youtube: string | null;
}

export interface Announcement {
  week: string;
  generatedAt: string;
  sermon: SermonBlock | null;
  next: { date: string; topic: string; owner: string | null; signup: string | null } | null;
  standing: Record<string, string> | null;
  past: Array<{ week: string; title: string | null; speaker: string | null; audio: string | null; slides: string | null; sermonSlides?: string | null; transcript: string | null }>;
}

function isoWeek(folderName: string): string {
  return `${folderName.slice(0, 4)}-${folderName.slice(4, 6)}-${folderName.slice(6, 8)}`;
}

/** Links for one week's folder, and the sermon title its file names carry. */
export function readWeekFiles(entries: DriveEntry[]): Omit<SermonBlock, 'speaker' | 'passage' | 'youtube'> & { deck: DriveEntry | null } {
  let audio: string | null = null;
  let slides: string | null = null;
  let sermonSlides: string | null = null;
  let transcript: string | null = null;
  let title: string | null = null;
  let deck: DriveEntry | null = null;

  for (const entry of entries) {
    const kind = classifyFile(entry.name, entry.mimeType);
    if (kind === 'audio' && !audio) audio = viewUrl(entry, kind);
    if (kind === 'slides' && !slides) { slides = viewUrl(entry, kind); deck = entry; }
    if (kind === 'sermonSlides' && !sermonSlides) sermonSlides = viewUrl(entry, kind);
    if (kind === 'transcript' && !transcript) transcript = viewUrl(entry, kind);
    if (!title && (kind === 'sermonDoc' || kind === 'sermonSlides' || kind === 'transcript')) title = sermonTitleFromName(entry.name);
  }
  return { title, audio, slides, sermonSlides, transcript, deck };
}

function readTabs(workbook: Buffer, tabs: string[]): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const tab of tabs) rows.push(...readPlanRows(xlsxSheetRows(workbook, tab)));
  return rows;
}

/** The deck, only ever for the sign-up link. Slides or an uploaded .pptx; both cost nothing to read. */
async function deckText(deck: DriveEntry | null): Promise<string | null> {
  if (!deck) return '';
  // A PDF deck carries no sign-up link this job can read; that block simply goes without one.
  if (deck.mimeType === 'application/pdf' || /\.pdf$/i.test(deck.name)) return '';
  if (deck.mimeType ? deck.mimeType === 'application/vnd.google-apps.presentation' : isGoogleNative(deck.id)) return await fetchSlidesText(deck.id);
  const binary = await fetchDriveFile(deck.id);
  return binary === null ? null : pptxSlideText(binary).join('\n');
}

function standingFrom(workbook: Buffer): Record<string, string> | null {
  const rows = xlsxSheetRows(workbook, STANDING_TAB);
  if (rows.length === 0) return null;
  const standing: Record<string, string> = {};
  for (const [key, value] of rows) {
    const name = (key ?? '').trim();
    const text = (value ?? '').trim();
    if (name && text && name !== 'key') standing[name] = text;
  }
  return Object.keys(standing).length > 0 ? standing : null;
}

/** The dated service sheet labels the speaker explicitly; program-tab owners can be a group. */
function speakersByWeek(workbook: Buffer): Map<string, string> {
  const rows = xlsxSheetRows(workbook, '2026服事表');
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim() === '日期')
    && row.some((cell) => cell.trim() === '講員'));
  if (headerIndex < 0) return new Map();
  const header = rows[headerIndex];
  const dateColumn = header.findIndex((cell) => cell.trim() === '日期');
  const speakerColumn = header.findIndex((cell) => cell.trim() === '講員');
  const speakers = new Map<string, string>();
  for (const row of rows.slice(headerIndex + 1)) {
    const date = excelSerialToDate(Number(row[dateColumn]));
    const speaker = (row[speakerColumn] ?? '').trim();
    if (date && speaker) speakers.set(date, speaker);
  }
  return speakers;
}

export interface BuildOptions {
  today: string;
  parentFolder?: string;
  /** Read-only last-good item; it supplies missing speaker metadata and preserves links after a folder failure. */
  previousWeek?: (week: string) => Announcement['past'][number] | null;
}

export async function buildAnnouncement(options: BuildOptions): Promise<{ announcement: Announcement | null; reason?: string; warnings?: string[] }> {
  const parent = options.parentFolder ?? PARENT_FOLDER;
  const html = await fetchFolderHtml(parent);
  if (html === null) return { announcement: null, reason: 'FOLDER_UNREACHABLE' };

  const folders = parseFolderListing(html);
  const chosen = pickWeekFolder(folders, options.today);
  if (!chosen) return { announcement: null, reason: 'NO_WEEK_FOLDER' };
  const week = isoWeek(chosen.name);

  const weekHtml = await fetchFolderHtml(chosen.id);
  if (weekHtml === null) return { announcement: null, reason: 'WEEK_FOLDER_UNREACHABLE' };
  const files = readWeekFiles(parseFolderListing(weekHtml));

  const [program, sunday] = await Promise.all([fetchWorkbook(PROGRAM_WORKBOOK), fetchWorkbook(SUNDAY_WORKBOOK)]);
  if (program === null || sunday === null) return { announcement: null, reason: 'REQUIRED_WORKBOOK_UNREACHABLE' };
  let sermonRows: PlanRow[], gatheringRows: PlanRow[], standing: Record<string, string> | null;
  let speakers: Map<string, string>;
  try {
    sermonRows = readTabs(program, SERMON_TABS);
    gatheringRows = readTabs(program, GATHERING_TABS);
    standing = standingFrom(sunday);
    speakers = speakersByWeek(sunday);
  } catch {
    return { announcement: null, reason: 'REQUIRED_WORKBOOK_UNREADABLE' };
  }

  const thisWeekSermon = rowFor(sermonRows, week);
  const upcoming = nextAfter([...gatheringRows, ...sermonRows], week);
  const deck = await deckText(files.deck);
  if (deck === null) return { announcement: null, reason: 'DECK_UNREACHABLE' };
  const signup = findSignupUrl(deck);

  // A block with nothing in it is omitted rather than rendered empty: the phone shows what exists.
  const sermon: SermonBlock | null = files.title || files.audio || files.slides || files.sermonSlides || thisWeekSermon
    ? {
        title: files.title ?? (thisWeekSermon ? headline(thisWeekSermon.topic) : null),
        speaker: thisWeekSermon?.owner || null,
        passage: thisWeekSermon?.note || null,
        audio: files.audio, slides: files.slides, transcript: files.transcript,
        // Only when the week has one, so a file without a sermon deck reads exactly as before.
        ...(files.sermonSlides ? { sermonSlides: files.sermonSlides } : {}),
        youtube: null,
      }
    : null;

  const past: Announcement['past'] = [];
  const warnings: string[] = [];
  for (const folder of listWeekFolders(folders, options.today).slice(1, PAST_WEEKS + 1)) {
    const priorWeek = isoWeek(folder.name);
    let remembered: Announcement['past'][number] | null = null;
    let cacheRead = false;
    const sameWeekCache = (): Announcement['past'][number] | null => {
      if (!cacheRead) {
        remembered = options.previousWeek?.(priorWeek) ?? null;
        cacheRead = true;
      }
      return remembered?.week === priorWeek ? remembered : null;
    };
    const speaker = speakers.get(priorWeek) ?? sameWeekCache()?.speaker ?? null;
    const listing = await fetchFolderHtml(folder.id);
    if (listing === null) {
      const lastGood = sameWeekCache();
      if (!lastGood || (!lastGood.audio && !lastGood.slides && !lastGood.sermonSlides && !lastGood.transcript)) {
        return { announcement: null, reason: `HISTORY_UNREACHABLE_WITHOUT_FALLBACK:${priorWeek}` };
      }
      past.push({ ...lastGood, speaker });
      warnings.push(`HISTORY_LAST_GOOD:${priorWeek}`);
      continue;
    }
    const older = readWeekFiles(parseFolderListing(listing));
    if (!older.audio && !older.slides && !older.sermonSlides && !older.transcript) continue;
    past.push({
      week: priorWeek, title: older.title, speaker,
      audio: older.audio, slides: older.slides, transcript: older.transcript,
      ...(older.sermonSlides ? { sermonSlides: older.sermonSlides } : {}),
    });
  }

  return {
    announcement: {
      week,
      generatedAt: new Date().toISOString(),
      sermon,
      next: upcoming ? { date: shortDate(upcoming.date), topic: headline(upcoming.topic), owner: upcoming.owner || null, signup } : null,
      standing,
      past,
    },
    ...(warnings.length ? { warnings } : {}),
  };
}
