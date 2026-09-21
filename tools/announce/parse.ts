/**
 * Everything the weekly announcement builder decides, with no network and no model.
 *
 * The published deck is a rendering of the spreadsheets, so nothing here reads a slide to learn a
 * fact that a sheet already states. What the deck folder uniquely provides is the *files* — the
 * recording, the slides, the transcript — and those are identified by name, not by content. So this
 * module is string handling, and the expensive parts stay out of it.
 */

export interface DriveEntry { id: string; name: string }

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
    entries.push({ id, name: decodeEntities(title[1].trim()) });
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

export type FileKind = 'slides' | 'audio' | 'transcript' | 'sermonDoc' | 'poster' | 'video' | 'other';

/**
 * What a file in the week folder is, by its name.
 *
 * Deliberately not by mime type: the folder listing does not carry one, and the naming here is
 * consistent and human-chosen. A file that does not match is `other` and is simply not linked,
 * which is the right outcome for anything unexpected appearing in the folder.
 */
export function classifyFile(name: string): FileKind {
  const lower = name.toLowerCase();
  if (/逐字稿/.test(name)) return 'transcript';
  if (/青崇講道/.test(name) && !/逐字稿/.test(name)) return 'sermonDoc';
  if (/\.(mp4|mov|m4v)$/.test(lower)) return 'video';
  if (/\.(mp3|m4a|wav)$/.test(lower)) return 'audio';
  if (/ppt$|\.pptx$|投影片|簡報/.test(lower) || /PPT$/.test(name)) return 'slides';
  if (/\.pdf$/.test(lower)) return 'poster';
  return 'other';
}

/** Google-native files get a 44-character id; an uploaded binary gets a shorter one. */
export function isGoogleNative(id: string): boolean {
  return id.length >= 40;
}

export function viewUrl(entry: DriveEntry, kind: FileKind): string {
  if (isGoogleNative(entry.id)) {
    if (kind === 'slides') return `https://docs.google.com/presentation/d/${entry.id}/preview`;
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
