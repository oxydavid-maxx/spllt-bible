import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Which LINE group an event came from (維護者 2026-10-20). The 靈修 and the 週刊 are posted only in the church's
 * 「竹科靈糧堂訊息公布欄」, but the bot is also being added to the youth groups, to compare their weekly notices with
 * the app's 下次聚會 later. A photo or a 靈修-looking text from any group other than the 公布欄 must never be kept.
 *
 * The first time an event comes from a group, LINE is asked for the group's name (server/lineContent.ts) and the
 * group is told apart by how its name starts. From then on the group ID decides; the name is not asked again. The
 * private file keeps only {"groups": {<group ID>: <group name>}}: no message, no member. A group whose name cannot
 * be looked up is not the 公布欄 for that event (better to miss one than to keep another group's post); the next
 * event asks again.
 */
export type LineGroupPurpose = 'bulletin-board' | 'youth-announcements' | 'youth-leaders' | 'other';

const PURPOSES: ReadonlyArray<readonly [prefix: string, purpose: LineGroupPurpose]> = [
  ['竹科靈糧堂訊息公布欄', 'bulletin-board'],
  // Recorded for the coming comparison with 下次聚會; nothing is done with their messages yet.
  ['青少牧區公告', 'youth-announcements'],
  ['青崇輔導', 'youth-leaders'],
];

export function lineGroupPurpose(name: string): LineGroupPurpose {
  const text = name.normalize('NFC').trim();
  return PURPOSES.find(([prefix]) => text.startsWith(prefix))?.[1] ?? 'other';
}

export interface LineGroupDirectory {
  /** The group's purpose; null when LINE could not be asked its name this time. */
  purposeOf(groupId: string): Promise<LineGroupPurpose | null>;
}

export interface LineGroupDirectoryOptions {
  /** The private file of groups seen so far; without one they are remembered until the server restarts. */
  file?: string;
  /** Asks LINE for the group's name (server/lineContent.ts). */
  lookup: (groupId: string) => Promise<{ groupName: string }>;
  log?: (line: string) => void;
}

function readGroups(file: string | undefined): Map<string, string> {
  if (!file) return new Map();
  try {
    const groups = (JSON.parse(readFileSync(file, 'utf8')) as { groups?: unknown }).groups;
    if (!groups || typeof groups !== 'object') return new Map();
    return new Map(Object.entries(groups).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return new Map();
  }
}

/** Only a code of ours (LINE_GROUP_404, LINE_TOKEN_400, …) is logged; anything else is the network. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^LINE_[A-Z0-9_]{1,40}$/.test(message) ? message : 'NETWORK';
}

export function createLineGroupDirectory(options: LineGroupDirectoryOptions): LineGroupDirectory {
  const log = options.log ?? ((line: string) => console.log(line));
  const names = readGroups(options.file);
  // One question to LINE per group, however many of its events arrive together.
  const asking = new Map<string, Promise<LineGroupPurpose | null>>();

  function remember(): void {
    if (!options.file) return;
    mkdirSync(dirname(options.file), { recursive: true });
    // Written beside the file and renamed over it, so a restart never reads half of it.
    const partial = `${options.file}.${randomUUID()}.partial`;
    writeFileSync(partial, `${JSON.stringify({ groups: Object.fromEntries(names) }, null, 2)}\n`, 'utf8');
    renameSync(partial, options.file);
  }

  async function ask(groupId: string): Promise<LineGroupPurpose | null> {
    let name: string;
    try {
      name = (await options.lookup(groupId)).groupName;
    } catch (error) {
      log(`LINE_GROUP_LOOKUP_FAILED reason=${reasonOf(error)}`);
      return null;
    }
    names.set(groupId, name);
    const purpose = lineGroupPurpose(name);
    // JSON quoting keeps a name with a line break on one log line.
    log(`LINE_GROUP_SEEN name=${JSON.stringify(name)} purpose=${purpose}`);
    try { remember(); } catch { log('LINE_GROUP_SAVE_FAILED'); }
    return purpose;
  }

  return {
    purposeOf(groupId: string): Promise<LineGroupPurpose | null> {
      const name = names.get(groupId);
      if (name !== undefined) return Promise.resolve(lineGroupPurpose(name));
      let answer = asking.get(groupId);
      if (!answer) {
        answer = ask(groupId).finally(() => asking.delete(groupId));
        asking.set(groupId, answer);
      }
      return answer;
    },
  };
}
