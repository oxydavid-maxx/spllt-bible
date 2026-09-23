"""Load production configuration and launch the backend, from a pinned git worktree.

Migrated from the untracked C:/dev/apps/qingmu-youth/ops/deployment_support.py. The
only structural change is `LIVE`: instead of a hardcoded path to an untracked copy,
it is computed from this file's own location, which must be the ops/ directory of a
clean, pinned git worktree -- `launch()` calls
pinned_worktree.preflight_against_declared_pin(LIVE, PIN_PATH) before touching any
production secret and refuses (propagating WorktreeNotPinnedError) if the worktree has
drifted, or if its HEAD is not the commit `PIN_PATH` declares. See ops/README.md for
the env-var test seams (QINGMU_PILOT_DIR_OVERRIDE, QINGMU_SERVER_PORT_OVERRIDE,
QINGMU_CFG_SHA_OVERRIDE): each defaults to exactly today's production hardcoded value
and is only ever set by a dry-run harness, never by the real Windows-logon start.

PIN_PATH declares, from OUTSIDE the git worktree, which single commit this deployment
is supposed to be running -- see pinned_worktree.read_declared_pin()'s docstring for why
that has to live outside the tree (a commit landing directly inside the live pinned
worktree on 2026-09-23 moved its HEAD without anyone touching anything outside it; the
next start would otherwise have silently run whatever HEAD had become).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
from reminder_config import read_reminder_environment
from ai_runtime import read_ai_environment, read_committed_boundary_bytes
from pinned_worktree import preflight_against_declared_pin

PILOT = Path(os.environ.get('QINGMU_PILOT_DIR_OVERRIDE')
              or r'C:/Users/User/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/QingmuYouthPilot')
LIVE = Path(__file__).resolve().parent.parent
CFG_SHA = os.environ.get('QINGMU_CFG_SHA_OVERRIDE') \
    or '2baa5b89b739e9758e5b4e826af857eadb649d579f5eb98ad544f65f71252023'
PORT = int(os.environ.get('QINGMU_SERVER_PORT_OVERRIDE') or '8788')
PIN_PATH = PILOT / 'pinned-commit.json'

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def inspect_database():
    db = sqlite3.connect((PILOT / 'pilot.sqlite').as_uri() + '?mode=ro', uri=True)
    try:
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        columns, counts = {}, {}
        for table in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            columns[table] = [r[1] for r in db.execute(f'PRAGMA table_info({quoted})')]
            counts[table] = db.execute(f'SELECT count(*) FROM {quoted}').fetchone()[0]
        check = db.execute('PRAGMA quick_check').fetchall()
        schema = json.dumps(columns, sort_keys=True, separators=(',', ':')).encode()
        return {'schema_sha256': hashlib.sha256(schema).hexdigest(), 'tables': columns, 'counts': counts,
                'integrity_ok': check == [('ok',)], 'journal_mode': db.execute('PRAGMA journal_mode').fetchone()[0],
                'user_version': db.execute('PRAGMA user_version').fetchone()[0]}
    finally:
        db.close()

def launch(label):
    if not label.replace('-', '').isalnum():
        raise ValueError('INVALID_LOG_LABEL')
    # Refuse before touching any secret: a drifted worktree, or one whose HEAD is not
    # the commit PIN_PATH declares, must not even get as far as reading
    # pilot-private-config.json.
    commit = preflight_against_declared_pin(LIVE, PIN_PATH)
    config_path = PILOT / 'pilot-private-config.json'
    if digest(config_path) != CFG_SHA:
        raise ValueError('CONFIG_CHANGED')
    cfg = json.loads(config_path.read_text(encoding='utf-8-sig'))
    admin_subjects = cfg.get('adminGoogleSubjects')
    if not isinstance(admin_subjects, list) or not admin_subjects or not all(isinstance(value, str) and value.strip() for value in admin_subjects):
        raise ValueError('PRODUCTION_ADMIN_AUTH_CONFIG_INVALID')
    if cfg.get('instanceId') != 'qingmu-pilot-08e0903c0bb3' or not cfg.get('googleServerClientId') or not cfg.get('sessionSecret'):
        raise ValueError('PRODUCTION_AUTH_CONFIG_INVALID')
    keep = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT']
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env['PATH'] = r'C:\Program Files\nodejs;C:\Windows\System32;C:\Windows'
    env.update({
        'QINGMU_DB_PATH': str(PILOT / 'pilot.sqlite'),
        'QINGMU_INSTANCE_ID': 'qingmu-pilot-08e0903c0bb3',
        'QINGMU_SERVER_PORT': str(PORT),
        'QINGMU_GOOGLE_SERVER_CLIENT_ID': str(cfg['googleServerClientId']),
        'QINGMU_SESSION_SECRET': str(cfg['sessionSecret']),
        'QINGMU_POINT_POLICY_VERSION': 'pilot-test-v1',
        'QINGMU_POINT_POLICY_STATUS': 'ACTIVE',
        'QINGMU_POINTS_PER_COMPLETION': '1',
        'QINGMU_ADMIN_GOOGLE_SUBJECTS': ','.join(value.strip() for value in admin_subjects),
        'QINGMU_WEEKLY_GOAL_TARGET': '3',
        'EXPO_PUBLIC_QINGMU_FIXTURE': 'false',
        'EXPO_PUBLIC_QINGMU_QA_TEST_AUDIO': 'false',
        'QINGMU_REMINDER_WORKER_AUTOSTART': 'false',
        # Estimating what a suggested prize costs uses the Claude CLI already installed for
        # this user. No path, no worker, and nominations behave exactly as they did before
        # any of this was built — which is also what every test sees, since none of them set it.
    })
    ai_env, ai_status = read_ai_environment(PILOT / 'ai-runtime-config.json', LIVE)
    env.update(ai_env)
    # Existing production data must never be overwritten by bootstrap seeds on restart.
    reminder_env, reminder_status = read_reminder_environment(PILOT / 'reminder-runtime-config.json')
    env.update(reminder_env)
    forbidden = ['QINGMU_INVITE_SEED_FILE', 'QINGMU_GROUP_PROFILE_FILE', 'QINGMU_FIXTURE_ROSTER', 'QINGMU_DEV_TOKEN', 'EXPO_PUBLIC_QINGMU_DEV_TOKEN']
    assert not any(k in env for k in forbidden)
    node = Path(r'C:/Program Files/nodejs/node.exe')
    args = [str(node), '--require', str(LIVE / 'node_modules/tsx/dist/preflight.cjs'), '--import',
            (LIVE / 'node_modules/tsx/dist/loader.mjs').as_uri(), 'server/http.ts']
    stdout_path, stderr_path = PILOT / f'server-{PORT}-{label}.log', PILOT / f'server-{PORT}-{label}.err.log'
    if stdout_path.exists() or stderr_path.exists():
        raise ValueError('LAUNCH_LOG_ALREADY_EXISTS')
    with stdout_path.open('xb') as out, stderr_path.open('xb') as err:
        child = subprocess.Popen(args, cwd=LIVE, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                 close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
    time.sleep(0.3)
    return {'pid': child.pid, 'exit_code_at_probe': child.poll(), 'config_sha256': CFG_SHA,
            'commit': commit, 'node_sha256': digest(node), 'cwd': str(LIVE), 'env_names': sorted(env),
            'bootstrap_seeds_absent': True, 'fixture_off': True, 'stdout': str(stdout_path), 'stderr': str(stderr_path),
            'secrets_printed': False, 'reminder_config_status': reminder_status, 'ai_status': ai_status,
            # The committed blob hash, not the working-tree file's raw bytes: this is
            # exactly the value read_ai_environment() checked the pin against, and the
            # value a private-config update should ever be pinned to. Reporting the
            # working-tree hash here is what made the 2026-09-23 incident's stale
            # CRLF-vs-blob pin look like the "current" value in the first place.
            'ai_boundary_sha256': hashlib.sha256(read_committed_boundary_bytes(LIVE)).hexdigest()}

parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['inspect-db', 'launch'])
parser.add_argument('--label')
args = parser.parse_args()
print(json.dumps(inspect_database() if args.mode == 'inspect-db' else launch(args.label), ensure_ascii=False))
