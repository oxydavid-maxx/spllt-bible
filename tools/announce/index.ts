import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildAnnouncement, type Announcement } from './build';
import { reviewAnnouncement } from './review';

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
const OUT_DIR = 'announcements';

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 120_000 }).trim();
}

/** Everything except when the job happened to run. */
function contentOf(announcement: Announcement): string {
  const { generatedAt, ...rest } = announcement;
  void generatedAt;
  return JSON.stringify(rest);
}

function changedSince(path: string, announcement: Announcement): boolean {
  try {
    return contentOf(JSON.parse(readFileSync(path, 'utf8')) as Announcement) !== contentOf(announcement);
  } catch {
    return true;
  }
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

  // generatedAt changes on every run, so comparing whole files would commit an identical
  // announcement twice a week for the rest of the term. What matters is whether the content moved.
  const week = announcement.week.replace(/-/g, '');
  const latestPath = join(REPO, OUT_DIR, 'latest.json');
  if (!changedSince(latestPath, announcement)) {
    process.stdout.write(`NO CHANGE for ${announcement.week}\n`);
    return 0;
  }
  for (const name of ['latest.json', `${week}.json`]) {
    const path = join(REPO, OUT_DIR, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, json, 'utf8');
  }

  git(REPO, ['add', OUT_DIR]);
  if (!git(REPO, ['status', '--porcelain', '--', OUT_DIR])) {
    process.stdout.write(`NO CHANGE for ${announcement.week}\n`);
    return 0;
  }
  git(REPO, ['commit', '-m', `Announcement for ${announcement.week}`]);
  git(REPO, ['push']);
  process.stdout.write(`PUBLISHED ${announcement.week}\n`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stdout.write(`FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
