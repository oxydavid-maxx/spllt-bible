"""Opt-in estimation policy; stale or absent configuration never enables a worker."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

BOUNDARY_RELATIVE_PATH = 'server/claudeCli.ts'


def read_committed_boundary_bytes(live_root, ref='HEAD'):
    """Return the exact bytes git has stored for `server/claudeCli.ts` at `ref`.

    Deliberately not `(Path(live_root) / BOUNDARY_RELATIVE_PATH).read_bytes()`: that
    reads the *working-tree* copy, whose line endings depend on the local
    `core.autocrlf` setting -- a pinned worktree checked out with autocrlf=true has
    CRLF on disk while one checked out elsewhere with autocrlf=false (or the original
    untracked qingmu-youth copy, mixed CRLF/LF) does not, even though both are the same
    commit with identical content. That mismatch produced a real BOUNDARY_MISMATCH at
    the 2026-09-23 cutover for a file nobody had actually changed.

    `git cat-file blob <ref>:<path>` returns exactly the bytes stored in the object
    database -- never touched by any checkout-time filter -- so the same commit always
    hashes the same everywhere, regardless of any local git config. `live_root` must be
    a git worktree (true for every caller of read_ai_environment in this project: it is
    always the pinned worktree, already verified clean by pinned_worktree.preflight()
    before this function is ever reached).
    """
    result = subprocess.run(
        ['git', 'cat-file', 'blob', f'{ref}:{BOUNDARY_RELATIVE_PATH}'],
        cwd=str(live_root), capture_output=True, timeout=15,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode != 0:
        raise OSError(f'BOUNDARY_BLOB_UNAVAILABLE: {result.stderr.decode(errors="replace").strip()}')
    return result.stdout


def read_ai_environment(config_path, live_root):
    config_path = Path(config_path)
    if not config_path.exists():
        return {}, 'DISABLED'
    try:
        config = json.loads(config_path.read_text(encoding='utf-8-sig'))
        if not isinstance(config, dict) or type(config.get('enabled')) is not bool:
            return {}, 'INVALID_CONFIG'
        if not config['enabled']:
            return {}, 'DISABLED'
        executable, expected = config.get('executable'), config.get('boundarySha256')
        if (not isinstance(executable, str) or not Path(executable).is_absolute()
                or not Path(executable).is_file() or not isinstance(expected, str)
                or not re.fullmatch(r'[0-9a-f]{64}', expected)):
            return {}, 'INVALID_CONFIG'
        actual = hashlib.sha256(read_committed_boundary_bytes(live_root)).hexdigest()
        if actual != expected:
            return {}, 'BOUNDARY_MISMATCH'
        return {'QINGMU_CLAUDE_CLI_PATH': executable}, 'ENABLED_VERIFIED'
    except (OSError, ValueError, TypeError):
        return {}, 'INVALID_CONFIG'
