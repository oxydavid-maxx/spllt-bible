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
