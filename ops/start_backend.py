"""Per-user Windows logon entry. Preserve the existing production data and identity.

Migrated from the untracked C:/dev/apps/qingmu-youth/ops/start_backend.py. `LIVE` is now
this file's own worktree root (BASE.parent) instead of a hardcoded path to an untracked
copy, and `preflight(LIVE)` is called before anything else -- a dirty or unpinned
worktree is refused (`{"status": "REFUSED", "reason": "DIRTY_WORKTREE", ...}`) before the
mutex is even used for real work.

The previous SHA256 hash-pin on deployment_support.py's own bytes (`LAUNCHER_CHANGED`)
is REMOVED, not kept alongside this. preflight() already verifies that file (and every
other tracked file in this worktree) matches its committed content exactly, and -- unlike
a hand-computed hash -- that guarantee updates itself automatically on every re-pin
instead of requiring a human to recompute and hardcode a new SHA256 each time. The two
"Pin re-bound" incidents recorded in this file's history were exactly that manual step
going stale; the git pin structurally cannot go stale the same way. CFG_SHA (the pin on
the real pilot-private-config.json secret file, which lives outside git in PILOT) and
ai_runtime.py's boundarySha256 (the claudeCli.ts security boundary) are unrelated to
source drift and are unchanged.
"""
import ctypes
import datetime
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
from backend_owner import record_successful_start
from pinned_worktree import preflight, WorktreeNotPinnedError

BASE = Path(__file__).resolve().parent
LIVE = BASE.parent
HELPER = BASE / 'deployment_support.py'
INSTANCE = 'qingmu-pilot-08e0903c0bb3'
RESULT = BASE / 'last-startup-result.json'
# Test-only seam: a dry run on a scratch port passes this; the real Startup shortcut
# invocation never sets it, so PORT is always 8788 in production.
PORT = int(os.environ.get('QINGMU_SERVER_PORT_OVERRIDE') or '8788')


def healthy():
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/health', timeout=3) as response:
        value = json.load(response)
        return response.status == 200 and value == {
            'status': 'ok', 'instanceId': INSTANCE, 'authMode': 'google-only'}


def start():
    # Refuse before anything else -- including before the mutex does any real work --
    # if this worktree is not an exact, clean checkout of a single commit.
    commit = preflight(LIVE)
    # Concurrent logon/manual calls must not create multiple backend writers. Scoped to
    # PORT so a scratch-port dry run never contends with a real production start.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.restype = ctypes.c_void_p
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    mutex = kernel.CreateMutexW(None, False, f'Local\\QingmuYouthBackendStartup-{PORT}')
    if not mutex:
        raise RuntimeError('STARTUP_MUTEX_FAILED')
    if ctypes.get_last_error() == 183:
        kernel.CloseHandle(mutex)
        return {'status': 'ALREADY_STARTING'}
    try:
        with socket.socket() as probe:
            listening = probe.connect_ex(('127.0.0.1', PORT)) == 0
        if listening:
            if not healthy():
                raise RuntimeError('PORT_OWNER_NOT_EXPECTED_HEALTHY_BACKEND')
            return {'status': 'ALREADY_RUNNING', 'commit': commit}
        label = 'startup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
        result = subprocess.run([sys.executable, str(HELPER), 'launch', '--label', label],
                                capture_output=True, text=True, timeout=20,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise RuntimeError('LAUNCH_FAILED')
        launch = json.loads(result.stdout)
        for _ in range(30):
            try:
                if healthy():
                    return {'status': 'STARTED_HEALTHY', 'pid': launch['pid'], 'commit': commit,
                            'bootstrap_seeds_absent': launch['bootstrap_seeds_absent'],
                            'fixture_off': launch['fixture_off'], 'ai_status': launch['ai_status'],
                            'ai_boundary_sha256': launch['ai_boundary_sha256']}
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        raise RuntimeError('STARTED_BUT_HEALTH_NOT_CONFIRMED')
    finally:
        kernel.CloseHandle(mutex)


if __name__ == '__main__':
    try:
        receipt = start()
        code = 0
    except WorktreeNotPinnedError as error:
        receipt = {'status': 'REFUSED', 'reason': error.reason, 'detail': error.detail}
        code = 1
    except Exception as error:
        receipt = {'status': 'FAILED', 'error_type': type(error).__name__}
        code = 1
    receipt['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record_successful_start(BASE / 'active-backend.json', receipt)
    RESULT.write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    sys.exit(code)
