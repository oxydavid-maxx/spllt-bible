import { fetchDocText, fetchDriveFile, fetchFolderHtml, fetchSlidesText, fetchWorkbook } from './fetch';
import { pptxSlideText, xlsxSheetRows } from './office';
import {
  classifyFile, findSignupUrl, isGoogleNative, listWeekFolders, nextAfter, parseFolderListing,
  pickWeekFolder, readPlanRows, rowFor, sermonTitleFromName, shortDate, viewUrl,
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
  slides: string | null;
  transcript: string | null;
  youtube: string | null;
}

export interface Announcement {
  week: string;
  generatedAt: string;
  sermon: SermonBlock | null;
  next: { date: string; topic: string; owner: string | null; signup: string | null } | null;
  standing: Record<string, string> | null;
  past: Array<{ week: string; title: string | null; audio: string | null; slides: string | null; transcript: string | null }>;
}

function isoWeek(folderName: string): string {
  return `${folderName.slice(0, 4)}-${folderName.slice(4, 6)}-${folderName.slice(6, 8)}`;
}

/** Links for one week's folder, and the sermon title its file names carry. */
export function readWeekFiles(entries: DriveEntry[]): Omit<SermonBlock, 'speaker' | 'passage' | 'youtube'> & { deck: DriveEntry | null } {
  let audio: string | null = null;
  let slides: string | null = null;
  let transcript: string | null = null;
  let title: string | null = null;
  let deck: DriveEntry | null = null;

  for (const entry of entries) {
    const kind = classifyFile(entry.name);
    if (kind === 'audio' && !audio) audio = viewUrl(entry, kind);
    if (kind === 'slides' && !slides) { slides = viewUrl(entry, kind); deck = entry; }
    if (kind === 'transcript' && !transcript) transcript = viewUrl(entry, kind);
    if (!title && (kind === 'sermonDoc' || kind === 'transcript')) title = sermonTitleFromName(entry.name);
  }
  return { title, audio, slides, transcript, deck };
}

async function readTabs(workbook: Buffer | null, tabs: string[]): Promise<PlanRow[]> {
  if (!workbook) return [];
  const rows: PlanRow[] = [];
  for (const tab of tabs) rows.push(...readPlanRows(xlsxSheetRows(workbook, tab)));
  return rows;
}

/** The deck, only ever for the sign-up link. Slides or an uploaded .pptx; both cost nothing to read. */
async function deckText(deck: DriveEntry | null): Promise<string> {
  if (!deck) return '';
  if (isGoogleNative(deck.id)) return (await fetchSlidesText(deck.id)) ?? '';
  const binary = await fetchDriveFile(deck.id);
  return binary ? pptxSlideText(binary).join('\n') : '';
}

function standingFrom(workbook: Buffer | null): Record<string, string> | null {
  if (!workbook) return null;
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

export interface BuildOptions { today: string; parentFolder?: string }

export async function buildAnnouncement(options: BuildOptions): Promise<{ announcement: Announcement | null; reason?: string }> {
  const parent = options.parentFolder ?? PARENT_FOLDER;
  const html = await fetchFolderHtml(parent);
  if (!html) return { announcement: null, reason: 'FOLDER_UNREACHABLE' };

  const folders = parseFolderListing(html);
  const chosen = pickWeekFolder(folders, options.today);
  if (!chosen) return { announcement: null, reason: 'NO_WEEK_FOLDER' };
  const week = isoWeek(chosen.name);

  const weekHtml = await fetchFolderHtml(chosen.id);
  if (!weekHtml) return { announcement: null, reason: 'WEEK_FOLDER_UNREACHABLE' };
  const files = readWeekFiles(parseFolderListing(weekHtml));

  const [program, sunday] = await Promise.all([fetchWorkbook(PROGRAM_WORKBOOK), fetchWorkbook(SUNDAY_WORKBOOK)]);
  const sermonRows = await readTabs(program, SERMON_TABS);
  const gatheringRows = await readTabs(program, GATHERING_TABS);

  const thisWeekSermon = rowFor(sermonRows, week);
  const upcoming = nextAfter([...gatheringRows, ...sermonRows], week);
  const signup = findSignupUrl(await deckText(files.deck));

  // A block with nothing in it is omitted rather than rendered empty: the phone shows what exists.
  const sermon: SermonBlock | null = files.title || files.audio || files.slides || thisWeekSermon
    ? {
        title: files.title ?? thisWeekSermon?.topic ?? null,
        speaker: thisWeekSermon?.owner || null,
        passage: thisWeekSermon?.note || null,
        audio: files.audio, slides: files.slides, transcript: files.transcript,
        youtube: null,
      }
    : null;

  const past: Announcement['past'] = [];
  for (const folder of listWeekFolders(folders, options.today).slice(1, PAST_WEEKS + 1)) {
    const listing = await fetchFolderHtml(folder.id);
    if (!listing) continue;
    const older = readWeekFiles(parseFolderListing(listing));
    if (!older.audio && !older.slides && !older.transcript) continue;
    past.push({ week: isoWeek(folder.name), title: older.title, audio: older.audio, slides: older.slides, transcript: older.transcript });
  }

  return {
    announcement: {
      week,
      generatedAt: new Date().toISOString(),
      sermon,
      next: upcoming ? { date: shortDate(upcoming.date), topic: upcoming.topic, owner: upcoming.owner || null, signup } : null,
      standing: standingFrom(sunday),
      past,
    },
  };
}
