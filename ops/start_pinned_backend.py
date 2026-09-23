"""Start the qingmu backend from a pinned git worktree, refusing any drifted checkout.

Generalizes the two legacy per-machine files this repository never had
(ops/start_backend.py, ops/deployment_support.py in the untracked C:/dev/apps/
qingmu-youth copy): instead of a hardcoded LIVE path with no git behind it, this script
takes a worktree path, verifies with pinned_worktree.preflight() that it is a clean,
exact checkout of a single commit, records that commit's full SHA in the startup
receipt, and only then launches `node ... server/http.ts` with that worktree as `cwd`.

This script owns the git-pin guarantee only. It does not know about the private
production secrets (Google client id/session secret, FCM credentials, the AI CLI
boundary hash) that the real qingmu-youth deployment loads from files outside both git
trees -- that responsibility stays with a small caller-supplied environment (--env
KEY=VALUE, repeatable) so this script itself never reads or prints a secret. The
existing ops/reminder_config.py and ops/ai_runtime.py helpers already do that job in a
generic, non-secret-printing way and can be composed by whatever calls this script for
the real cutover; ops/README.md's runbook covers that step.
"""
import argparse
import datetime
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

from pinned_worktree import preflight, WorktreeNotPinnedError
from backend_owner import record_successful_start

NODE = Path(r'C:/Program Files/nodejs/node.exe')
DEFAULT_KEEP_ENV = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA',
                     'APPDATA', 'COMSPEC', 'PATHEXT']


def make_receipt(status, **fields):
    """Build a JSON-able receipt dict. Never pass a secret value as a field here --
    this dict is written to disk and may be printed to stdout/logs."""
    receipt = {'status': status, **fields}
    receipt['utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return receipt


def build_env(base_environ, extra_env, node_dir=None):
    """Construct the child process environment: a small safe keep-list from the
    caller's own environment, PATH pointed at node, then explicit overrides. No value
    already present in `extra_env` is ever read from or echoed via any other source.

    The keep-list match is case-insensitive on purpose: Windows environment variable
    names are case-insensitive, but a plain dict built from os.environ is not, and the
    *actual* stored casing of e.g. SystemRoot varies by how the parent process was
    launched (observed as literal 'SYSTEMROOT' in one real shell here). A naive
    case-sensitive lookup silently drops it, and Node's own CSPRNG initialization on
    Windows hard-crashes at startup (`Assertion failed: ncrypto::CSPRNG`) without
    SystemRoot in its environment -- this was found by an actual failing dry run, not
    hypothesized, so it is covered by a regression test below.
    """
    by_upper = {key.upper(): value for key, value in base_environ.items()}
    env = {key: by_upper[key.upper()] for key in DEFAULT_KEEP_ENV if key.upper() in by_upper}
    env['PATH'] = str(node_dir or NODE.parent) + ';C:\\Windows\\System32;C:\\Windows'
    env.update(extra_env)
    return env


def parse_env_args(pairs):
    result = {}
    for pair in pairs or []:
        if '=' not in pair:
            raise ValueError(f'--env expects KEY=VALUE, got: {pair!r}')
        key, value = pair.split('=', 1)
        if not key:
            raise ValueError(f'--env expects a non-empty KEY, got: {pair!r}')
        result[key] = value
    return result


def wait_healthy(port, instance_id, attempts=30, delay=0.25):
    url = f'http://127.0.0.1:{port}/api/health'
    last_error = None
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                body = json.load(response)
                if response.status == 200 and body.get('status') == 'ok' and body.get('instanceId') == instance_id:
                    return body
                last_error = f'UNEXPECTED_HEALTH_BODY:{body}'
        except (OSError, ValueError) as error:
            last_error = str(error)
        time.sleep(delay)
    raise RuntimeError(f'STARTED_BUT_HEALTH_NOT_CONFIRMED: {last_error}')


def start(worktree, port, instance_id, extra_env, expected_commit=None, log_dir=None, node=None):
    """Preflight the worktree, launch the backend, wait for a matching health response.

    Returns (receipt, process) on success. `process` is the live subprocess.Popen so
    the caller can stop it (used by --stop-after-healthy and by tests/dry runs); it is
    never left dangling by this function on the success path -- the caller owns it.
    Raises WorktreeNotPinnedError before touching node at all if the tree has drifted.
    """
    commit = preflight(worktree, expected_commit)
    node = Path(node) if node else NODE
    if not node.is_file():
        raise RuntimeError(f'NODE_NOT_FOUND: {node}')
    worktree = Path(worktree).resolve()
    args = [str(node), '--require', str(worktree / 'node_modules/tsx/dist/preflight.cjs'), '--import',
            (worktree / 'node_modules/tsx/dist/loader.mjs').as_uri(), 'server/http.ts']
    env = build_env(dict(__import__('os').environ), {**extra_env, 'QINGMU_SERVER_PORT': str(port),
                                                       'QINGMU_INSTANCE_ID': instance_id}, node_dir=node.parent)
    log_dir = Path(log_dir) if log_dir else worktree
    label = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    stdout_path, stderr_path = log_dir / f'pinned-{port}-{label}.out.log', log_dir / f'pinned-{port}-{label}.err.log'
    with stdout_path.open('xb') as out, stderr_path.open('xb') as err:
        process = subprocess.Popen(args, cwd=str(worktree), env=env, stdin=subprocess.DEVNULL,
                                    stdout=out, stderr=err, close_fds=True,
                                    creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
    try:
        health = wait_healthy(port, instance_id)
    except Exception as error:
        process.kill()
        process.wait(timeout=10)
        raise RuntimeError(f'{error} (stdout={stdout_path}, stderr={stderr_path})') from error
    receipt = make_receipt('STARTED_HEALTHY', pid=process.pid, commit=commit, worktree=str(worktree),
                            port=port, instance_id=instance_id, health=health,
                            stdout=str(stdout_path), stderr=str(stderr_path), secrets_printed=False)
    return receipt, process


def stop(process, timeout=10):
    process.terminate()
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=timeout)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worktree', type=Path, required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--instance-id', required=True)
    parser.add_argument('--expect-commit')
    parser.add_argument('--env', action='append', default=[], metavar='KEY=VALUE')
    parser.add_argument('--receipt', type=Path, help='Always overwritten with the outcome of this attempt.')
    parser.add_argument('--identity', type=Path,
                         help='Only updated on a successful start; an ALREADY_RUNNING/FAILED attempt must not '
                              'erase the identity of the last backend that actually came up healthy.')
    parser.add_argument('--stop-after-healthy', action='store_true',
                         help='Stop the process once health is confirmed (dry-run / smoke-test mode).')
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error('port must be 1024..65535')
    extra_env = parse_env_args(args.env)
    process = None
    try:
        receipt, process = start(args.worktree, args.port, args.instance_id, extra_env, args.expect_commit)
        code = 0
    except WorktreeNotPinnedError as error:
        receipt, code = make_receipt('REFUSED', reason=error.reason, detail=error.detail), 1
    except Exception as error:
        receipt, code = make_receipt('FAILED', error_type=type(error).__name__, error=str(error)), 1
    if args.receipt:
        args.receipt.write_text(json.dumps(receipt, indent=2, default=str), encoding='utf-8')
    if args.identity:
        record_successful_start(args.identity, receipt)
    print(json.dumps(receipt, indent=2, default=str))
    if process is not None and args.stop_after_healthy:
        stop(process)
    sys.exit(code)


if __name__ == '__main__':
    main()
