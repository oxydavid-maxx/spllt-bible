# W3 Announcements receipt

## Candidate

- CEO session: `01a0ce94-61d3-7552-b87e-6d9813a7d9b5`; report route: `/root`.
- Worktree: `C:/dev/machine/worktrees/qm-c23-w3`.
- Branch: `codex/qm-compact-announcements`.
- Base: `f561b83d8719d12ee55d2a1c5466a9cbbcab3074`, verified against freshly fetched `origin/main`.
- Commit: `160f6e8002366943397ab9cfbf7beb6d218c432b`.
- Commit tree: `9ecae249d864211d1a8c286ec0bbb61b0cdee17d`.
- Worktree was clean at handoff.
- 開發時間:0 小時 30 分(14:29:10 → 14:59:37 UTC,1827 秒)

## Authority and source record

The requested plan path `docs/superpowers/plans/2026-09-23-qingmu-compact-student-release.md` was absent from the original checkout and `origin/main` at the pinned base. CEO `/root` supplied the previously validated R09/§7 excerpt while the plan was recovered. I then read the restored authority at `C:/dev/apps/qingmu-bible/.handoff/compact-20260923/2026-09-23-qingmu-compact-student-release.md`; its SHA256 matched `8c3f86d1ade9fd851453a429d0e51a8a900db2050e184ab5e49ea925b000f9bf`. No stash apply/pop/reset was performed by this worker.

The existing announcement `latest.json` and `20260920.json` identify the four history weeks as 2026-09-13, 2026-09-06, 2025-12-13, and 2025-06-14. Their public folder names confirm those years.

For 2026 speakers, the link-readable official Sunday workbook `1XVzcYvDzIum-HEjuFWwVBJ9_ZphV4sFy3p-xneQSScU`, tab `2026服事表`, has columns `日期 | 講員 | ...`. Its 2026-09-13 row names `中亮`; its 2026-09-06 row names `為潔`. The 9/13 and 9/6 official slide decks independently identify 中亮哥 and 為潔, respectively. The program workbook's 9/13 Owner value `中亮/大專` is a group assignment, so it is not used as a speaker.

Neither 2025 date appears in the available 2026 service or sermon schedules. The 2025-12-13 folder has a presentation whose title slide gives no speaker. The 2025-06-14 folder's sermon deck title is `為什麼我們家的狗狗不是黑色的？`; the inspected title slides and explicit speaker markers provide no speaker name. Both stay `speaker: null`; no name was inferred.

## Changes

- Producer history items now read speaker only from the explicit dated `講員` field and leave unmatched weeks null.
- Last-good `previousWeek` fallback carries a cached speaker forward.
- The client parses speakers from new payloads and maps missing/blank legacy values to null.
- The past row renders date, speaker, and any existing title without a one-line clip; row wrapping lets long names remain visible. Link rows remain connected.
- The current announcement files received only `past[].speaker` additions. The two confirmed speakers are 中亮 and 為潔; the two unverified speakers are null. Before/after checks confirmed top-level week, generatedAt, sermon, next, standing, and each past title/audio/slides/transcript value were unchanged. The two announcement files remain byte-content equivalent to each other.
- W1 Reader, W2 Points, backend, and Obsidian files were not modified.

Changed files:

- `tools/announce/build.ts`
- `tools/announce/index.ts`
- `src/services/announcementClient.ts`
- `src/ui/AnnouncementBoard.tsx`
- `announcements/latest.json`
- `announcements/20260920.json`
- `tests/tools/announceBuild.test.ts`
- `tests/tools/announcePublisher.test.ts`
- `tests/tools/announceIngest.test.ts`
- `tests/services/announcementClient.test.ts`
- `tests/ui/announcementBoard.test.ts`

## Verification

- FOCUS on exact commit `160f6e8002366943397ab9cfbf7beb6d218c432b`:
  `npm exec -- vitest run tests/tools/announceBuild.test.ts tests/tools/announcePublisher.test.ts tests/services/announcementClient.test.ts tests/ui/announcementBoard.test.ts`
  Result: 4 files passed, 46 tests passed.
- `npm run typecheck`: passed on the same commit.
- `git diff --check`: passed before commit.
- UI tests emit the existing `react-test-renderer` deprecation and `act(...)` environment warnings; all tests pass.
- No app build, live announcement publication, GitHub/Play publication, or phone input was performed.
