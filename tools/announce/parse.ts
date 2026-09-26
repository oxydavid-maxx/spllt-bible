/**
 * Everything the weekly announcement builder decides, with no network and no model.
 *
 * The published deck is a rendering of the spreadsheets, so nothing here reads a slide to learn a
 * fact that a sheet already states. What the deck folder uniquely provides is the *files* — the
 * recording, the slides, the transcript — and those are identified by name, not by content. So this
 * module is string handling, and the expensive parts stay out of it.
 */

/** mimeType comes from the listing's file-type icon; a listing without one leaves it out. */
export interface DriveEntry { id: string; name: string; mimeType?: string }

/**
 * Entries out of Drive's embedded folder view.
 *
 * That endpoint is not documented and could change. It is parsed here, in one function, so that the
 * day it changes there is exactly one thing to fix and a test that says what it used to return.
 */
export function parseFolderListing(html: string): DriveEntry[] {
  const entries: DriveEntry[] = [];
  for (const block of html.split('id="entry-').slice(1)) {
    const quote = block.indexOf('"');
    if (quote <= 0) continue;
    const id = block.slice(0, quote);
    const title = /flip-entry-title">([^<]+)/.exec(block);
    if (!id || !title) continue;
    const type = /\/16\/type\/([^"?#\s]+)/.exec(block);
    entries.push({ id, name: decodeEntities(title[1].trim()), ...(type ? { mimeType: decodeURIComponent(type[1]) } : {}) });
  }
  return entries;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/**
 * The week folder to build from: the most recent `YYYYMMDD` that is not in the future.
 *
 * Not simply the newest folder. Somebody preparing next Sunday early would otherwise publish next
 * week's announcement over this week's, and the people looking at it are still in this week.
 */
export function pickWeekFolder(entries: DriveEntry[], today: string): DriveEntry | null {
  const compact = today.replace(/-/g, '');
  let chosen: DriveEntry | null = null;
  for (const entry of entries) {
    if (!/^\d{8}$/.test(entry.name)) continue;
    if (entry.name > compact) continue;
    if (!chosen || entry.name > chosen.name) chosen = entry;
  }
  return chosen;
}

/** Week folders, newest first, for the "past Sundays" list. */
export function listWeekFolders(entries: DriveEntry[], today: string): DriveEntry[] {
  const compact = today.replace(/-/g, '');
  return entries
    .filter((entry) => /^\d{8}$/.test(entry.name) && entry.name <= compact)
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** slides is the whole-service deck (報告 included); sermonSlides is the sermon's own deck (講道). */
export type FileKind = 'slides' | 'sermonSlides' | 'audio' | 'transcript' | 'sermonDoc' | 'poster' | 'video' | 'other';

const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';
const GOOGLE_DOC = 'application/vnd.google-apps.document';

/** A deck in any of the forms it arrives in: Google Slides, an uploaded PowerPoint, or a PDF. */
function isDeck(name: string, mimeType?: string): boolean {
  if (mimeType) return mimeType === GOOGLE_SLIDES || mimeType === 'application/pdf' || /presentationml|powerpoint/.test(mimeType);
  return /\.(pptx?|pdf)$/i.test(name) || /PPT$/.test(name);
}

/**
 * What a file in the week folder is, by its name.
 *
 * Deliberately not by mime type: the folder listing does not carry one, and the naming here is
 * consistent and human-chosen. A file that does not match is `other` and is simply not linked,
 * which is the right outcome for anything unexpected appearing in the folder.
 */
export function classifyFile(name: string, mimeType?: string): FileKind {
  const lower = name.toLowerCase();
  if (/逐字稿/.test(name)) return 'transcript';
  // 20260920 青崇講道｜先 is the sermon's deck when it is a deck, and the manuscript (which only
  // lends the week its title) when it is a document. Only the listing's file type tells them apart.
  if (/講道/.test(name)) return isDeck(name, mimeType) ? 'sermonSlides' : 'sermonDoc';
  if (/\.(mp4|mov|m4v)$/.test(lower)) return 'video';
  if (/\.(mp3|m4a|wav)$/.test(lower)) return 'audio';
  if (/ppt$|\.pptx$|投影片|簡報/.test(lower) || /PPT$/.test(name)) return 'slides';
  if (mimeType === GOOGLE_SLIDES || (mimeType && /presentationml|powerpoint/.test(mimeType))) return 'slides';
  // A PDF is a poster unless it is the whole-service deck, 20261004青崇(全).pdf.
  if (/\.pdf$/.test(lower)) return /[（(]全[)）]/.test(name) ? 'slides' : 'poster';
  return 'other';
}

/** Google-native files get a 44-character id; an uploaded binary gets a shorter one. */
export function isGoogleNative(id: string): boolean {
  return id.length >= 40;
}

/** The URL that opens the file for its type; the id shape and the kind are the fallback when the listing gives no type. */
export function viewUrl(entry: DriveEntry, kind: FileKind): string {
  if (entry.mimeType === GOOGLE_SLIDES) return `https://docs.google.com/presentation/d/${entry.id}/preview`;
  if (entry.mimeType === GOOGLE_DOC) return `https://docs.google.com/document/d/${entry.id}/view`;
  if (!entry.mimeType && isGoogleNative(entry.id)) {
    if (kind === 'slides' || kind === 'sermonSlides') return `https://docs.google.com/presentation/d/${entry.id}/preview`;
    if (kind === 'transcript' || kind === 'sermonDoc') return `https://docs.google.com/document/d/${entry.id}/view`;
  }
  return `https://drive.google.com/file/d/${entry.id}/view`;
}

/**
 * The sermon title out of a file name like `20260920 青崇講道｜先｜現場逐字稿`.
 *
 * The title is what the person typed when they named the file, which is also what they announced.
 * Taking it from the deck would mean parsing a slide to recover something already written here.
 */
export function sermonTitleFromName(name: string): string | null {
  const parts = name.split('｜').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const title = parts[1];
  return title && !/逐字稿/.test(title) ? title : null;
}

/** Excel serials count days from 1899-12-30. Sheets hands them out for every date cell. */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Math.round(serial) * 86400000 + Date.UTC(1899, 11, 30);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A headline out of a topic cell.
 *
 * The 青年啟發 tab keeps the session title and its discussion questions in one cell, separated by
 * newlines, so using the cell whole turns a four-line block into a sermon title. The first line is
 * the title as the deck announces it — 生命：這就是人生嗎？ — and the rest is material for the
 * small groups, not for a notice board.
 */
export function headline(topic: string): string {
  return String(topic ?? '').split(/\r?\n/)[0].trim();
}

export interface PlanRow { date: string; topic: string; owner: string; note: string }

/**
 * Rows out of one of the schedule tabs.
 *
 * Every tab in these workbooks shares the same first four columns — Date, Topic, Owner, Note — even
 * where the columns beside them differ, so one reader serves all of them. A row whose date does not
 * resolve is dropped rather than guessed at.
 */
export function readPlanRows(rows: string[][]): PlanRow[] {
  const out: PlanRow[] = [];
  for (const row of rows.slice(1)) {
    const date = excelSerialToDate(Number(row[0]));
    const topic = (row[1] ?? '').trim();
    if (!date || !topic) continue;
    out.push({ date, topic, owner: (row[2] ?? '').trim(), note: (row[3] ?? '').trim() });
  }
  return out;
}

/** The first scheduled thing strictly after the week being published. */
export function nextAfter(rows: PlanRow[], week: string): PlanRow | null {
  let best: PlanRow | null = null;
  for (const row of rows) {
    if (row.date <= week) continue;
    if (!best || row.date < best.date) best = row;
  }
  return best;
}

/** The row for the week being published, if the plan has one. */
export function rowFor(rows: PlanRow[], week: string): PlanRow | null {
  return rows.find((row) => row.date === week) ?? null;
}

/** A sign-up form, wherever it appears. Deck text, a note column, anywhere. */
export function findSignupUrl(text: string): string | null {
  const match = /https:\/\/forms\.gle\/[A-Za-z0-9]+/.exec(text) ?? /https:\/\/docs\.google\.com\/forms\/[^\s"'<>]+/.exec(text);
  return match ? match[0] : null;
}

/** `9/27`, the way it is said out loud, from `2026-09-27`. */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(month)}/${Number(day)}`;
}
