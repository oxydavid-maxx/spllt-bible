import type { Announcement } from './build';

export type LinkAccess = 'open' | 'needs-sign-in' | 'missing' | 'unknown';

const LINK_FIELDS = ['audio', 'sermonSlides', 'slides', 'transcript'] as const;

/**
 * Members open these links in a browser tab, and most of them have no access to the church folder,
 * so a link that asks for a Google sign-in is a dead button (光佑, 2026-09-26). Such a link, and one
 * whose file is gone, is left out of the published file and named in the log so its sharing can be
 * set to 知道連結的任何人：檢視者. A link that could not be checked stays: a failed check says
 * nothing about the file.
 */
export async function dropLinksNeedingSignIn(announcement: Announcement, access: (url: string) => Promise<LinkAccess>): Promise<string[]> {
  const warnings: string[] = [];
  const blocks: Array<{ week: string; links: Partial<Record<(typeof LINK_FIELDS)[number], string | null>> }> = [];
  for (const session of announcement.sessions ?? []) blocks.push({ week: announcement.week, links: session });
  for (const past of announcement.past) for (const session of past.sessions ?? []) blocks.push({ week: past.week, links: session });
  if (announcement.sermon) blocks.push({ week: announcement.week, links: announcement.sermon });
  for (const past of announcement.past) blocks.push({ week: past.week, links: past });
  const observed = new Map<string, LinkAccess>();
  const inspect = async (url: string) => { if (!observed.has(url)) observed.set(url, await access(url)); return observed.get(url)!; };
  for (const { week, links } of blocks) {
    for (const field of LINK_FIELDS) {
      const url = links[field];
      if (!url) continue;
      const result = await inspect(url);
      if (result !== 'needs-sign-in' && result !== 'missing') continue;
      links[field] = null;
      warnings.push(`LINK_${result === 'missing' ? 'MISSING' : 'NEEDS_SHARING'}:${week}:${field}:${url}`);
    }
  }
  for (const [week, sessions] of [[announcement.week, announcement.sessions], ...announcement.past.map(past => [past.week, past.sessions])] as Array<[string, typeof announcement.sessions]>) {
    for (const session of sessions ?? []) if (session.materials) {
      const kept = [];
      for (const file of session.materials) {
        const result = await inspect(file.url);
        if (result === 'needs-sign-in' || result === 'missing') warnings.push(`LINK_${result === 'missing' ? 'MISSING' : 'NEEDS_SHARING'}:${week}:${file.role}:${file.url}`);
        else kept.push(file);
      }
      session.materials = kept;
    }
  }
  return warnings;
}
