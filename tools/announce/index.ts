import { buildAnnouncement } from './build';
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

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const skipReview = argv.includes('--skip-review');
  const dateFlag = argv.indexOf('--date');
  const today = dateFlag >= 0 ? argv[dateFlag + 1] : taipeiToday();

  const { announcement, reason } = await buildAnnouncement({ today });
  if (!announcement) {
    process.stdout.write(`NOT PUBLISHED: ${reason}\n`);
    return 1;
  }

  const json = `${JSON.stringify(announcement, null, 2)}\n`;
  if (dryRun) {
    process.stdout.write(json);
    return 0;
  }

  if (!skipReview) {
    const verdict = await reviewAnnouncement(announcement);
    if (!verdict.sensible) {
      // Refusing to publish is the safe failure: last week's file stays, which is stale but true.
      process.stdout.write(`NOT PUBLISHED: review said ${verdict.reason ?? 'no'}\n`);
      return 1;
    }
  }

  const result = publishAnnouncement(REPO, announcement);
  process.stdout.write(`${result === 'published' ? 'PUBLISHED' : 'NO CHANGE for'} ${announcement.week}\n`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stdout.write(`FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
