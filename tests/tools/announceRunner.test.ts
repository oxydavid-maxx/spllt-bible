import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The scheduled job used to run the announcement code in the maintainer's working tree. On 2026-10-02
// a fix had been merged the day before, but that checkout still sat on an older main and the 09:00 run
// published the old second-session wording again. The runner must publish with main's code, whatever
// branch or edit the working tree holds, and publish nothing when it cannot get that code.
const commands = readFileSync('tools/announce/run.cmd', 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim() && !/^\s*REM\b/i.test(line));
const at = (pattern: RegExp) => commands.findIndex((line) => pattern.test(line));

describe('announcement runner', () => {
  it('checks out main into its own code checkout before running', () => {
    const fetch = at(/git -C "%REPO%" fetch .*refs\/heads\/main:refs\/remotes\/origin\/main/);
    const checkout = at(/git -C "%CODE%" checkout .*--force refs\/remotes\/origin\/main/);
    const run = at(/index\.ts/);
    expect(fetch).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeGreaterThan(fetch);
    expect(run).toBeGreaterThan(checkout);
  });

  it('runs the code from that checkout, never from the working tree', () => {
    expect(commands.filter((line) => /index\.ts/.test(line)))
      .toEqual([expect.stringContaining('"%CODE%\\tools\\announce\\index.ts"')]);
  });

  it('publishes nothing when main cannot be checked out', () => {
    const gitSteps = commands.filter((line) => /^(if not exist .*)?git -C /.test(line.trim()));
    expect(gitSteps).toHaveLength(3);
    for (const line of gitSteps) expect(line).toMatch(/\|\| goto :no_code$/);
    const noCode = commands.slice(at(/^:no_code$/));
    expect(noCode.some((line) => /node /.test(line))).toBe(false);
    expect(noCode.at(-1)).toBe('exit /b 1');
  });
});
