"""Refuse to treat a directory as a deployable backend unless it is an exact,
clean checkout of a single git commit.

This is the mechanism the case for this ticket asks for: the live backend at
C:/dev/apps/qingmu-youth is a plain copy with no git, so nothing stops someone from
hand-editing a file there and nobody noticing. A "pinned worktree" is a git worktree
(typically created with `git worktree add --detach <path> <commit>`) that this module
verifies, on every start attempt, still matches its own HEAD commit exactly -- no
modified tracked files, no untracked files, nothing staged. If the tree has drifted in
any way, starting is refused instead of silently serving stale-looking-but-actually-
different code.
"""
import json
import re
import subprocess
from pathlib import Path


class WorktreeNotPinnedError(RuntimeError):
    """A worktree is not a clean, exact checkout of a single known commit.

    `reason` is a short machine-readable code (see module docstring callers); `detail`
    carries whatever evidence explains the refusal (git output, a path, a dict of
    expected/actual values). Never put secret values in `detail` -- only paths, git
    status lines and commit hashes ever land here.
    """

    def __init__(self, reason, detail=None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f'{reason}: {detail}')


def _git(args, cwd):
    result = subprocess.run(
        ['git', *args], cwd=str(cwd), capture_output=True, text=True,
        timeout=15, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode != 0:
        raise WorktreeNotPinnedError('GIT_COMMAND_FAILED', {'args': args, 'stderr': result.stderr.strip()})
    return result.stdout


def preflight(worktree_root, expected_commit=None):
    """Return the full 40-character commit SHA of a clean, pinned worktree.

    Raises WorktreeNotPinnedError, and starts nothing, when any of the following hold:
      - NOT_A_GIT_WORKTREE: the path has no .git (not a git checkout at all).
      - NOT_WORKTREE_ROOT: the path is inside a git repo but is not itself the
        checkout root (refuses to silently "adopt" a parent/child directory).
      - DIRTY_WORKTREE: `git status` reports any modified, staged, or untracked file
        (this is the drift the live qingmu-youth copy has suffered from repeatedly).
      - COMMIT_NOT_RESOLVED: HEAD does not resolve to a normal 40-character SHA
        (e.g. a fresh repo with no commits yet).
      - COMMIT_MISMATCH: `expected_commit` was given and does not match HEAD -- for
        callers that want to additionally assert *which* commit this deployment must be
        (not just that the tree is internally consistent).
    """
    root = Path(worktree_root).resolve(strict=True)
    if not (root / '.git').exists():
        raise WorktreeNotPinnedError('NOT_A_GIT_WORKTREE', str(root))
    toplevel = _git(['rev-parse', '--show-toplevel'], root).strip()
    if Path(toplevel).resolve() != root:
        raise WorktreeNotPinnedError('NOT_WORKTREE_ROOT', {'requested': str(root), 'actual_root': toplevel})
    status = _git(['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules'], root)
    dirty = [line for line in status.splitlines() if line.strip()]
    if dirty:
        raise WorktreeNotPinnedError('DIRTY_WORKTREE', dirty[:20])
    commit = _git(['rev-parse', 'HEAD'], root).strip()
    if len(commit) != 40 or any(char not in '0123456789abcdef' for char in commit.lower()):
        raise WorktreeNotPinnedError('COMMIT_NOT_RESOLVED', commit)
    if expected_commit and commit.lower() != expected_commit.strip().lower():
        raise WorktreeNotPinnedError('COMMIT_MISMATCH', {'expected': expected_commit, 'actual': commit})
    return commit


def read_declared_pin(pin_path):
    """Return the full commit SHA a deployment is *declared* to run, from a small JSON
    record living OUTSIDE the git worktree -- e.g. `{"commit": "<40-hex sha>"}`.

    Why this has to live outside the worktree: `preflight(worktree_root)` alone only
    proves the tree is internally consistent with *its own* HEAD -- clean, no drift from
    whatever commit it happens to be on right now. It says nothing about whether that
    HEAD is the commit this deployment is actually supposed to be running. On
    2026-09-23 a commit (`6f37bfc`) landed directly inside the live pinned worktree
    `C:\\dev\\machine\\worktrees\\qingmu-bible\\r-7fe612f`, moving its HEAD past the
    intended pin `7fe612f` without anyone touching anything outside the worktree; the
    running backend was unaffected, but the *next* start would have silently run
    whatever HEAD had become, since nothing outside the tree said otherwise. A record
    that lives outside the worktree cannot be moved by a commit inside it.

    Raises WorktreeNotPinnedError, never returns a partial/best-effort value:
      - PIN_RECORD_MISSING: no file at `pin_path`.
      - PIN_RECORD_INVALID: unreadable, not JSON, not an object, or `commit` is not a
        40-character lowercase-or-mixed-case hex SHA.
    """
    pin_path = Path(pin_path)
    if not pin_path.is_file():
        raise WorktreeNotPinnedError('PIN_RECORD_MISSING', str(pin_path))
    try:
        record = json.loads(pin_path.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError) as error:
        raise WorktreeNotPinnedError('PIN_RECORD_INVALID', f'{pin_path}: {error}') from error
    commit = record.get('commit') if isinstance(record, dict) else None
    if not isinstance(commit, str) or not re.fullmatch(r'[0-9a-fA-F]{40}', commit):
        raise WorktreeNotPinnedError('PIN_RECORD_INVALID', f'{pin_path}: "commit" must be a 40-character hex SHA')
    return commit.lower()


def preflight_against_declared_pin(worktree_root, pin_path):
    """The check every real caller should use: read the declared pin record, then
    preflight the worktree against it. Calling preflight() alone (no expected_commit)
    is not enough on its own -- see read_declared_pin()'s docstring for why."""
    expected = read_declared_pin(pin_path)
    return preflight(worktree_root, expected_commit=expected)
