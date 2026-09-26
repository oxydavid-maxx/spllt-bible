import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAnnouncement, type Announcement } from './build';
import { linkAccess } from './fetch';
import { dropLinksNeedingSignIn } from './linkAccess';
import { reviewAnnouncement } from './review';
import { publishAnnouncement } from './publisher';

/**
 * The weekly job, run twice: Sunday morning once the deck is up, Tuesday morning once the recording
 * has been posted. Both runs build the same file; the Tuesday one simply finds more in the folder.
 *
 * Everything up to the last step is a script, so the cost of a run is a few HTTP requests. The model
 * is asked one question at the end — does this look like a coherent week — and a no means the file
 * is not published rather than published wrong.
 */

// A checkout of the public repo on `main`, kept apart from this working tree so publishing a notice
// never depends on what branch development happens to be on. It lives under the machine-state
// worktrees capsule because C:\dev only admits the roots the dev-layout registry lists, and a second
// checkout of an application repo is not one of them.
const REPO = process.env.QINGMU_ANNOUNCE_REPO ?? 'C:/dev/machine/worktrees/qingmu-publish';

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Archived speakers fill missing schedule rows; unreadable/empty copies are not evidence. */
function previousWeek(week: string, fallbackFiles: Map<string, string | null>): Announcement['past'][number] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return null;
  // Preserve the history currently shown to members before consulting an older weekly archive.
  for (const name of ['latest.json', `${week.replace(/-/g, '')}.json`]) {
    const path = `announcements/${name}`;
    let raw: string | null = null;
    try { raw = readFileSync(join(REPO, path), 'utf8'); } catch { /* A missing copy may have another fallback. */ }
    // Bind the first read, including a missing/empty primary copy that led to the archive.
    if (!fallbackFiles.has(path)) fallbackFiles.set(path, raw);
    if (raw === null) continue;
    try {
      const prior = JSON.parse(raw) as Announcement;
      const item = prior.week === week ? prior.sermon : prior.past?.find((entry) => entry.week === week);
      if (!item) continue;
      const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
      const sermonSlides = text(item.sermonSlides);
      const result = {
        week, title: text(item.title), speaker: text(item.speaker),
        audio: text(item.audio), slides: text(item.slides), transcript: text(item.transcript),
        ...(sermonSlides ? { sermonSlides } : {}),
      };
      if (result.audio || result.slides || sermonSlides || result.transcript) return result;
    } catch { /* Try the other last-good copy; a broken cache must never invent a week. */ }
  }
  return null;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const skipReview = argv.includes('--skip-review');
  const dateFlag = argv.indexOf('--date');
  const today = dateFlag >= 0 ? argv[dateFlag + 1] : taipeiToday();

  const fallbackFiles = new Map<string, string | null>();
  const { announcement, reason, warnings } = await buildAnnouncement({ today, previousWeek: (week) => previousWeek(week, fallbackFiles) });
  if (!announcement) {
    process.stdout.write(`NOT PUBLISHED: ${reason}\n`);
    return 1;
  }
  for (const warning of await dropLinksNeedingSignIn(announcement, linkAccess)) process.stdout.write(`NOT LINKED: ${warning}\n`);

  const json = `${JSON.stringify(announcement, null, 2)}\n`;
  if (dryRun) {
    process.stdout.write(json);
    return 0;
  }

  for (const warning of warnings ?? []) process.stdout.write(`USING LAST GOOD: ${warning}\n`);

  if (!skipReview) {
    const verdict = await reviewAnnouncement(announcement);
    if (!verdict.sensible) {
      // Refusing to publish is the safe failure: last week's file stays, which is stale but true.
      process.stdout.write(`NOT PUBLISHED: review said ${verdict.reason ?? 'no'}\n`);
      return 1;
    }
  }

  const result = publishAnnouncement(REPO, announcement, { fallbackFiles });
  process.stdout.write(`${result === 'published' ? 'PUBLISHED' : 'NO CHANGE for'} ${announcement.week}\n`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stdout.write(`FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
