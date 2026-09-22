"""Restart only a port owner verified against health, process start and launch receipt.

The deployment must stop accepting test mutations and back up SQLite before calling
this entry. Legacy Windows backends have no graceful shutdown handler; this performs
a bounded process stop, then delegates startup to the existing official entry.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

from backend_owner import validate_owner


def powershell(command):
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                             "$ErrorActionPreference='Stop'; " + command],
                            capture_output=True, text=True, check=True, timeout=15,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    return json.loads(result.stdout) if result.stdout.strip() else None


def observe(root, port, instance):
    identity = root / 'ops' / 'active-backend.json'
    # First deployment can use the old successful receipt; subsequent no-op starts must not erase it.
    if not identity.exists():
        identity = root / 'ops' / 'last-startup-result.json'
    receipt = json.loads(identity.read_text(encoding='utf-8-sig'))
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=3) as response:
        health = json.load(response)
    observations = powershell(
        f'$listeners=@(Get-NetTCPConnection -LocalPort {port} -State Listen); '
        '$ids=@($listeners.OwningProcess | Sort-Object -Unique); '
        'if($ids.Count -ne 1){throw "AMBIGUOUS_PORT_OWNER"}; '
        '$p=Get-Process -Id $ids[0]; '
        '[pscustomobject]@{listeners=$ids;process=@{pid=$p.Id;name=$p.ProcessName;'
        "startedAt=$p.StartTime.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress")
    pid = validate_owner(instance, health, observations['listeners'], receipt, observations['process'])
    return pid, observations['process']['startedAt']


def restart(root, port, instance, check_only=False):
    pid, started = observe(root, port, instance)
    if check_only:
        return {'status': 'OWNER_VERIFIED', 'pid': pid, 'startedAt': started}
    # Bind stop to the same process start and port immediately before termination.
    powershell(f'$p=Get-Process -Id {pid}; '
               f'if((Get-NetTCPConnection -LocalPort {port} -State Listen).OwningProcess -ne {pid})'
               '{throw "PORT_OWNER_CHANGED"}; '
               f"if($p.StartTime.ToUniversalTime().ToString('o') -ne '{started}')"
               '{throw "PROCESS_CHANGED"}; $p | Stop-Process -Force')
    for _ in range(20):
        if not powershell(f'@(Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue).Count | ConvertTo-Json'):
            break
        time.sleep(.25)
    else:
        raise RuntimeError('PORT_NOT_RELEASED')
    subprocess.run([sys.executable, str(root / 'ops' / 'start_backend.py')], cwd=root,
                   check=True, timeout=45, creationflags=subprocess.CREATE_NO_WINDOW)
    new_pid, new_start = observe(root, port, instance)
    if new_pid == pid and new_start == started:
        raise RuntimeError('RESTART_NOT_OBSERVED')
    return {'status': 'RESTARTED_HEALTHY', 'previousPid': pid, 'pid': new_pid, 'startedAt': new_start}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live-root', type=Path, required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--instance-id', required=True)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('port must be 1024..65535')
    print(json.dumps(restart(args.live_root.resolve(strict=True), args.port, args.instance_id, args.check_only)))
