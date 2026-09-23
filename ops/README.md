# Backend operational safety

These small helpers extend an existing Windows deployment; they do not bootstrap a
new service, change its database, or replace its private authentication configuration.

## Optional AI estimation

The private launcher calls `read_ai_environment(config_path, live_root)` and adds
only its returned variables to the child environment. Remove any unconditional
`QINGMU_CLAUDE_CLI_PATH` assignment. An absent configuration disables estimation;
nominations, voting and manual pricing remain available.

After validating the real CLI boundary, the private configuration may contain:

```json
{
  "enabled": true,
  "executable": "C:/path/to/claude.exe",
  "boundarySha256": "<SHA256 of the exact verified server/claudeCli.ts bytes>"
}
```

The boundary hash must match the deployed file. Rolling back server code without
changing the hardened launcher disables AI automatically. Never restore the old
unrestricted launcher as part of a server rollback. CLI invocation itself disables
tools, MCP, customizations and persisted sessions while preserving authentication.

## Existing backend restart

The official starter calls `record_successful_start` after a healthy start and
stores its successful receipt in `ops/active-backend.json`. Routine
`ALREADY_RUNNING` results must not erase that process identity. There is no
separate launcher-file hash pin to keep in sync any more -- see "The official entry
point is now in git" below for why `pinned_worktree.preflight()` replaced it.

Run `restart_backend.py --live-root <deployment> --port <port> --instance-id <id>
--check-only` before deployment. It binds the live health response, listening PID,
Node process start and successful startup receipt. Missing or changed observations
refuse to stop anything. Omit `--check-only` only after capturing a consistent SQLite
backup and stopping test mutations. The legacy Windows process is terminated after
the same PID/start/port are rechecked, then the existing `ops/start_backend.py`
performs startup. No unrelated processes or service configurations are touched.

Run the bounded operational tests with:

```text
python -m unittest discover -s ops -p "test_*.py" -v
```

## Running the backend from a pinned git worktree

`pinned_worktree.py` and `start_pinned_backend.py` are the mechanism that lets the
backend run from a real git checkout instead of the untracked
`C:/dev/apps/qingmu-youth` copy it runs from today. `pinned_worktree.preflight()`
refuses (`WorktreeNotPinnedError`) unless the worktree passed to it is an exact, clean
checkout of a single commit -- any modified, staged, or untracked file is a refusal,
not a warning. `start_pinned_backend.py` calls that check before it will launch
`node ... server/http.ts`, and it writes the resolved full 40-character commit SHA into
the startup receipt every time.

This intentionally does not know about production secrets (Google client id/session
secret, FCM credentials, the AI CLI boundary hash). Those are the job of the real
official entry point below; `start_pinned_backend.py` never reads or prints one itself
(`secrets_printed: false` is asserted directly in its receipt) and stays useful as a
generic scratch-port smoke-test tool for any worktree.

Smoke-test any worktree on a scratch port without touching anything live:

```text
python ops/start_pinned_backend.py --worktree <path> --port 8799 \
  --instance-id smoke-test --env QINGMU_FIXTURE_ROSTER=two-member-week \
  --env QINGMU_DB_PATH=:memory: --env QINGMU_DISABLE_MEETING_REMINDERS=true \
  --receipt ops/last-smoke-result.json --stop-after-healthy
```

A dirty or untracked file anywhere in `<path>` makes this refuse with
`{"status": "REFUSED", "reason": "DIRTY_WORKTREE", ...}` and exit non-zero, before node
is ever started.

### Resolved: which commit backs the cutover

An earlier draft of this README flagged the `package.json` version gap between live
(`0.1.0`) and `main` (`0.5.x`) as a reason to stop and ask before picking a commit. That
concern was checked and closed on 2026-09-23: every file under `server/` in the live
`qingmu-youth` copy is byte-for-byte identical (CRLF-normalized) to
`origin/codex/qingmu-p2-repairs` (`8e2fb4b`, PR #2) except `server/communityProgress.ts`,
which is an *intended* change already in that PR. The version-number gap is a mobile-app
packaging fact, not evidence of undeployed backend drift. **The cutover target is `main`
once PR #2 merges — no separate owner decision is needed on which commit.**

## Cutover runbook: move the live backend onto a pinned git worktree

Mechanism only in this ticket; do not perform this cutover until it is separately
authorized. Every step here is reversible up to "retire qingmu-youth" (step 8), which
itself only recycles rather than deletes.

1. **Pick the commit.** `main` once PR #2 (`codex/qingmu-p2-repairs`) merges, per the
   resolved caveat above -- no separate decision needed.
2. **Create the pinned worktree.**
   ```text
   git -C C:/dev/apps/qingmu-bible worktree add --detach C:/dev/machine/worktrees/qingmu-bible/active <commit>
   ```
   Use a fresh subdirectory (not `active` again) for every future re-pin instead of
   reusing one in place, so a bad re-pin can be rolled back by pointing the shortcut at
   the previous directory.
3. **Install node_modules in the new worktree.** Either `npm ci` inside it (matches
   `package-lock.json` exactly, slower) or, if a trusted install of the *same*
   `package-lock.json` already exists elsewhere on this machine, a directory junction:
   `cmd /c mklink /J C:\dev\machine\worktrees\qingmu-bible\active\node_modules <trusted-node_modules>`.
   A junction is fine for a pinned worktree because the worktree itself is already
   immutable-by-refusal; it is not fine if the source install can drift independently.
4. **Nothing to write.** `ops/deployment_support.py` and `ops/start_backend.py` are now
   the real official entry point, already committed to this repo (see "The official
   entry point is now in git" below) -- the pinned worktree from step 2 already has
   them. There is no by-hand porting step anymore.
5. **Repoint the Startup shortcut.** Edit "Qingmu Backend.lnk" (`shell:startup`) so its
   target is:
   ```text
   Target: C:\Windows\System32\pythonw.exe
   Arguments: "C:\dev\machine\worktrees\qingmu-bible\active\ops\start_backend.py"
   Start in: C:\dev\machine\worktrees\qingmu-bible\active\ops
   ```
   (substitute whatever fresh subdirectory step 2 actually used if not `active`) instead
   of the one under `C:/dev/apps/qingmu-youth`. Do not delete the old shortcut target yet.
6. **Stop the old backend safely.**
   ```text
   python ops/restart_backend.py --live-root C:/dev/apps/qingmu-youth --port 8788 \
     --instance-id qingmu-pilot-08e0903c0bb3 --check-only
   ```
   Confirm `OWNER_VERIFIED` before proceeding. Then run the same command without
   `--check-only` only after the usual SQLite backup and pausing test mutations --
   `restart_backend.py` already refuses if the port owner, its process start time, or
   the last successful receipt disagree with what it just observed.
7. **Start the new backend and health-check it** on port 8788 with the new worktree's
   launcher (same instance id, same `/api/health` contract). Confirm
   `{"status":"ok","instanceId":"qingmu-pilot-08e0903c0bb3","authMode":"google-only"}`.
8. **Retire `qingmu-youth`.** Only after step 7 is confirmed healthy and stable for a
   reasonable soak period: send `C:/dev/apps/qingmu-youth` to the Recycle Bin (e.g.
   PowerShell's `Remove-Item -Recurse` is a **permanent** delete -- do not use it here;
   use Explorer's Delete, or a script that calls the Windows Shell "recycle" verb) --
   never a permanent delete. Do not touch `…/QingmuYouthPilot/pilot.sqlite`; it already
   lives outside both trees.

### Rollback

At any point before step 8: repoint the Startup shortcut back at
`C:/dev/apps/qingmu-youth/ops/start_backend.py`, run its `restart_backend.py` the same
way, and the old backend resumes exactly as before -- nothing about the old tree was
touched by any step above it. After step 8, rollback means restoring `qingmu-youth` from
the Recycle Bin (which is exactly why step 8 must recycle, not permanently delete).

### Files present only in `C:/dev/apps/qingmu-youth` (not reproducible from git)

Found by a read-only diff against this repo's tracked files; `qingmu-youth` was not
modified to produce this list. Sizes/formatting-only differences (CRLF vs LF on
otherwise-identical `data/*.json`/`.md` files, `ai_runtime.py`, `backend_owner.py`) are
excluded below since a clean `git checkout` reproduces those files byte-for-byte once
line endings are normalized.

| Path | What it is | Recommendation |
|---|---|---|
| `ops/deployment_support.py` | Private launcher: reads `PILOT` secrets, builds child env, spawns node | **Migrated** -- now `ops/deployment_support.py` in this repo, see below |
| `ops/start_backend.py` | Windows-logon entry point, mutex-guarded | **Migrated** -- now `ops/start_backend.py` in this repo, see below |
| `ops/reminder_config.py` | Reads optional FCM reminder config into env vars; not committed anywhere in this repo's history | **Migrated** -- copied verbatim, no secrets embedded |
| `ops/test_reminder_config.py` | Tests for the above | **Migrated** together with it |
| `ops/active-backend.json`, `ops/last-startup-result.json` | Runtime receipts, regenerated on every start | **Discard** -- ephemeral; the migrated launcher writes its own at the same paths, gitignored so a start attempt never makes its own worktree look dirty to the next `preflight()` call |
| `ops/__pycache__/*.pyc` | Bytecode cache | **Discard** -- regenerated automatically |
| `.expo/`, `dist/`, `android/`, `node_modules/` | Expo cache, build output, native project, installed deps | **Discard** -- all four are already in this repo's `.gitignore` and are fully reproducible (`expo prebuild`, `npm run export:android`, `npm ci`) |
| `.cutover-backups/*` | Snapshots this same manual process took before past hand-edits (several dated folders under `server/`, `src/`, `ops/`) | **Discard after step 8's soak period**, or archive a copy to the vault first if 光佑 wants the manual-cutover history preserved -- git history now supersedes them as the audit trail |
| `data/content/traditional-cuv/` | Empty directory (0 bytes of content today) | **Discard** -- nothing to migrate |
| `data/line-implementation-manifest.json` | A dated (2026-09-08) planning/status manifest, not referenced by server code | **Migrate to the vault** (per 光佑's standing doc-storage rule) rather than into git, since it reads as planning content, not shipped product code |

No `.env` file, credential file, or secret-named file was found anywhere in the
`qingmu-youth` tree outside `node_modules` -- secrets load from
`…/QingmuYouthPilot/pilot-private-config.json` and sibling files, entirely outside both
git trees, exactly as the case facts describe. Nothing above required modifying
`qingmu-youth`; all of it was read-only inspection (`diff`, `find`, size checks).

### One functional drift found earlier, now resolved

`ops/restart_backend.py` on the live machine had one line beyond what commit `7fba578`
brought into `main`: a `[Console]::OutputEncoding = ...UTF8Encoding...` prefix on its
internal `powershell()` helper, fixing PowerShell mangling non-ASCII `Get-Process`
output. This branch is now rebased onto `codex/qingmu-p2-repairs` (`8e2fb4b`), which
already carries that exact fix (commit `b80500b` on that line) -- confirmed identical
to the live file byte-for-byte (CRLF-normalized). No further action needed.

## The official entry point is now in git

`ops/start_backend.py` (the Windows-logon entry, mutex-guarded) and
`ops/deployment_support.py` (loads `PILOT` secrets, builds the child environment, spawns
`node ... server/http.ts`) are migrated into this repo, replacing the untracked copies at
`C:/dev/apps/qingmu-youth/ops/*`. The only structural change from the live versions:

- `LIVE` is no longer a hardcoded path. `deployment_support.py` computes it as
  `Path(__file__).resolve().parent.parent`; `start_backend.py` computes it as
  `BASE.parent`. Both resolve to whatever pinned worktree the file physically lives in
  -- re-pinning to a new worktree needs no code edit.
- `start_backend.py.start()` calls `pinned_worktree.preflight(LIVE)` before doing
  anything else (before the mutex does real work, before any secret is read). A dirty or
  unpinned worktree produces `{"status": "REFUSED", "reason": "DIRTY_WORKTREE", ...}` and
  exit code 1, written to `ops/last-startup-result.json` exactly like every other
  outcome. `deployment_support.py.launch()` independently re-checks the same thing
  (defense in depth; it is also directly invocable).
- **The old SHA256 hash-pin on `deployment_support.py`'s own bytes (`LAUNCHER_CHANGED`)
  is removed, not kept alongside the git pin.** `preflight()` already verifies that file,
  and every other tracked file in the worktree, matches its committed content exactly --
  and unlike a hand-computed hash, that guarantee updates itself automatically on every
  re-pin instead of requiring a human to recompute and hardcode a new SHA256 each time.
  The two "Pin re-bound" incidents recorded in the original file's history were exactly
  that manual step going stale; the git pin cannot go stale the same way. `CFG_SHA` (the
  pin on the real `pilot-private-config.json` secret file, which lives outside git in
  `PILOT`) and `ai_runtime.py`'s `boundarySha256` (the `claudeCli.ts` security boundary)
  are unrelated to source drift and are unchanged.
- Three env-var test seams exist, each defaulting to exactly today's hardcoded
  production value and read nowhere except at these three call sites:
  `QINGMU_PILOT_DIR_OVERRIDE` (default: the real `PILOT` path), `QINGMU_CFG_SHA_OVERRIDE`
  (default: the real `CFG_SHA`), `QINGMU_SERVER_PORT_OVERRIDE` (default: `8788`). **None
  of these are ever set by the real Startup-shortcut invocation** -- they exist purely so
  a dry run can exercise the exact same secret-loading code path against a scratch
  `PILOT` directory and a scratch port instead of the real one. See
  `ops/test_start_backend_pin.py` for the refusal tests.

Dry run performed 2026-09-23 from a real pinned worktree of this branch, port 8798, a
scratch `PILOT` directory containing a synthetic (non-real) `pilot-private-config.json`
shaped like the production one, with `QINGMU_CFG_SHA_OVERRIDE` set to that file's own
SHA256 (never the real `CFG_SHA`, which stays the hardcoded default everywhere else).
`python ops/start_backend.py` produced:

```json
{
  "status": "STARTED_HEALTHY",
  "pid": 25560,
  "commit": "8d5e4c872737c0d24ed989a2974f1a76d363182b",
  "bootstrap_seeds_absent": true,
  "fixture_off": true,
  "ai_status": "DISABLED",
  "ai_boundary_sha256": "4ffc55d336060c226662ce132e669298cbdc1027b81591027569754a76e1958c"
}
```

`GET /api/health` on port 8798 answered `{"status":"ok","instanceId":"qingmu-pilot-08e0903c0bb3","authMode":"google-only"}`
-- `google-only`, not `fixture`, confirming the real `deployment_support.py` secret-config
validation path ran, not a fixture shortcut. The process was then stopped directly (no
production traffic to protect on a scratch port). Editing a tracked file in the same
pinned worktree and re-running produced `{"status":"REFUSED","reason":"DIRTY_WORKTREE",...}`;
reverting the edit restored a clean run. Port 8788's owner (pid, start time) was checked
before, during, and after this entire dry run and never changed.
