import type { VerseTiming } from '../domain/chapterAudioContract';
import type { AssignedVerseRange } from '../domain/partialChapter';

export type PassageAudioWindow = { kind: 'chapter' } | { kind: 'unsegmented' } | { kind: 'range'; start: number; end: number };
export const UNSEGMENTED_AUDIO_NOTICE = '這段錄音沒有分節，會從頭播整章';

/** Timing belongs to the already resolved recording, never another version's same chapter. */
export function resolvePassageAudioWindow(range: AssignedVerseRange | null | undefined, timing: readonly VerseTiming[] | undefined): PassageAudioWindow {
  if (!range) return { kind: 'chapter' };
  const first = timing?.find(row => row.verse === range.firstVerse);
  const last = timing?.find(row => row.verse === range.lastVerse);
  if (!first || !last || !Number.isFinite(first.start) || !Number.isFinite(last.end)
    || first.start < 0 || last.end <= first.start) return { kind: 'unsegmented' };
  return { kind: 'range', start: first.start, end: last.end };
}
