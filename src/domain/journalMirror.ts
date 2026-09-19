/**
 * Decides what a mirrored journal file should be called and contain.
 *
 * The mirror is a copy, never the original. The server stays the one place a journal actually
 * lives, because that is what survives a lost phone and what lets a new phone get the writing back.
 * A folder on a device can do neither. What the folder gives you is everything else: the entry
 * lands inside whatever system you already keep your thinking in, as a plain file you own.
 *
 * Pure on purpose — no native module, no clock — so the rules about overwriting somebody else's
 * file are testable without a device, which is exactly the rule that must never be wrong.
 */

/** Written into every mirrored file so we can recognise our own on a later pass. */
export const MIRROR_SOURCE = 'qingmu-journal';

export interface MirrorFile {
  fileName: string;
  contents: string;
}

export function mirrorFileName(taskDate: string): string {
  return `${taskDate}.md`;
}

/**
 * Front matter first, so Obsidian reads the date and we can identify the file later. The body
 * follows verbatim: it is the member's own words and nothing here reformats them.
 */
export function buildMirrorFile(taskDate: string, body: string): MirrorFile {
  return {
    fileName: mirrorFileName(taskDate),
    contents: `---\nsource: ${MIRROR_SOURCE}\ndate: ${taskDate}\n---\n\n${body.trim()}\n`,
  };
}

/** True when this file was written by us on an earlier pass and may be replaced. */
export function isOurFile(existingContents: string): boolean {
  const header = existingContents.slice(0, 200);
  return header.startsWith('---') && header.includes(`source: ${MIRROR_SOURCE}`);
}

export type MirrorDecision =
  | { action: 'create' }
  | { action: 'replace' }
  | { action: 'skip'; reason: 'FOREIGN_FILE' };

/**
 * Whether it is safe to write.
 *
 * Someone will point this at a folder that already holds their daily notes — that is the natural
 * thing to do, and `2026-09-19.md` is exactly the name such a note already has. Overwriting it
 * would destroy work this app never created and cannot restore. So a file we did not write is
 * never touched; it is reported instead, and the member decides.
 */
export function decideMirrorWrite(existingContents: string | null): MirrorDecision {
  if (existingContents === null) return { action: 'create' };
  if (isOurFile(existingContents)) return { action: 'replace' };
  return { action: 'skip', reason: 'FOREIGN_FILE' };
}
