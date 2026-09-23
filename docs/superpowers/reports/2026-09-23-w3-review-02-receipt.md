# W3 R09 review 02 follow-up receipt

## Candidate

- CEO session: 01a0ce94-61d3-7552-b87e-6d9813a7d9b5; canonical report route: /root.
- Worktree: C:/dev/machine/worktrees/qm-c23-w3.
- Branch: codex/qm-compact-announcements.
- Parent W3 commit: 160f6e8002366943397ab9cfbf7beb6d218c432b.
- Follow-up commit: 4753a478f1299fb8f80bb453f9588cae2b237db3.
- Follow-up tree: eaf798e22a184c5bcfc7ae3ad65cb21eaea17e18.
- Worktree clean at handoff.

## Review response

Chair review 02 identified two paths with inconsistent cache ordering. Historical speaker resolution now checks the exact-week current service-table speaker first, then consults a last-good cache item only when that week has no current speaker. The cache item is accepted only when its week exactly matches the folder week. A readable folder uses its current title and links while borrowing only a missing speaker from the same-week cache. An unreadable folder keeps its last-good links and uses the current dated speaker when available.

The producer tests now cover:
- readable folder + missing schedule row + same-week cache speaker;
- rejection of a cache item dated to a different week;
- current explicit speaker winning over cache in both readable and unreadable folder branches.

No program-tab Owner value is used as a speaker. The RC owner's bounded tab-list readback confirms all 9 tabs in the current official workbook are 2026-related and there is no 2025 schedule worksheet. 2025-12-13 and 2025-06-14 remain null in the announcement data; no broader personal-data search was performed.

## Changed files

- tools/announce/build.ts
- tools/announce/index.ts
- tests/tools/announceBuild.test.ts

## Verification on exact follow-up commit

- Producer pack: npm exec -- vitest run tests/tools/announceBuild.test.ts tests/tools/announceIngest.test.ts
- Result: 2 files passed, 26 tests passed.
- npm run typecheck: passed.
- git diff --check: passed before commit.
- No app build, publication, push, or phone operation occurred.
- Original W3 receipt: .handoff/w3-announcements-receipt.md
