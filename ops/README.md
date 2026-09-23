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
`ALREADY_RUNNING` results must not erase that process identity. Keep the existing
launcher integrity pin in sync with any private helper changes.

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
secret, FCM credentials, the AI CLI boundary hash). Those stay the job of the existing
`ai_runtime.py` / (to be migrated) `reminder_config.py` helpers, composed by whichever
caller builds the real `--env KEY=VALUE` list for a live start; `start_pinned_backend.py`
never reads or prints one itself (`secrets_printed: false` is asserted directly in its
receipt).

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

### IMPORTANT caveat found while building this: git `main` is far ahead of the live app

The live `qingmu-youth` copy is running app `package.json` version `0.1.0`; this repo's
`main` is at `0.5.1`, with entire feature areas (gamification, journal, reminders,
announcement board, admin surfaces, and ~150 more test files) that exist in git and were
never deployed to the live copy. Only a handful of `server/*.ts` files were kept
byte-for-byte in sync by hand (see the "Bring the running backend's changes into version
control" commit). **Pinning the live Startup shortcut to a worktree at `main` HEAD is not
a like-for-like drift fix — it is a large feature jump.** Confirm with 光佑 which commit
should actually back the live shortcut before flipping it; do not assume `main` HEAD is
the intended target without that confirmation.

## Cutover runbook: move the live backend onto a pinned git worktree

Mechanism only in this ticket; do not perform this cutover until it is separately
authorized. Every step here is reversible up to "retire qingmu-youth" (step 8), which
itself only recycles rather than deletes.

1. **Decide the commit.** Read the caveat above first. Confirm with 光佑 which commit on
   this repo should back the live shortcut (likely not a blind `main` HEAD after this PR
   merges, given the version gap).
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
4. **Write the real launcher for this worktree.** Port `ops/deployment_support.py` /
   `ops/start_backend.py` from `C:/dev/apps/qingmu-youth` (see the non-git-file list
   below -- both are currently only on that machine, not in any git history) into this
   worktree's `ops/`, changing only: `LIVE` -> the pinned worktree path, and add a call
   to `pinned_worktree.preflight(LIVE, expected_commit=<the decided commit>)` before
   `launch()` builds the node command. Keep `PILOT`, the config SHA pin, and the
   Windows-logon mutex logic as they are -- none of that is git-related.
5. **Repoint the Startup shortcut.** Edit "Qingmu Backend.lnk" (`shell:startup`) so its
   target argument is the new `ops/start_backend.py` under the pinned worktree, not the
   one under `C:/dev/apps/qingmu-youth`. Do not delete the old shortcut target yet.
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
| `ops/deployment_support.py` | Private launcher: reads `PILOT` secrets, builds child env, spawns node | **Migrate** into the pinned worktree per step 4 above; no secrets are hardcoded in the file itself |
| `ops/start_backend.py` | Windows-logon entry point, mutex-guarded | **Migrate** alongside `deployment_support.py`, same step |
| `ops/reminder_config.py` | Reads optional FCM reminder config into env vars; not committed anywhere in this repo's history | **Migrate** (no secrets embedded; only paths/flags) |
| `ops/test_reminder_config.py` | Tests for the above | **Migrate** together with it |
| `ops/active-backend.json`, `ops/last-startup-result.json` | Runtime receipts, regenerated on every start | **Discard** -- ephemeral, will be recreated by the new launcher's own receipts |
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

### One functional drift already found beyond the file list

`ops/restart_backend.py` on the live machine has one line beyond what commit `7fba578`
brought into this repo: a `[Console]::OutputEncoding = ...UTF8Encoding...` prefix on its
internal `powershell()` helper, fixing PowerShell mangling non-ASCII `Get-Process`
output. It is a real, working fix that is not yet in git. Out of scope for this ticket
(mechanism only), but worth a follow-up commit before or during the cutover so the
migrated `restart_backend.py` does not regress that fix.
