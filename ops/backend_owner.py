"""Validate all independent observations before stopping a backend process."""
from datetime import datetime
import json
from pathlib import Path


def record_successful_start(path, receipt):
    if receipt.get('status') == 'STARTED_HEALTHY' and type(receipt.get('pid')) is int:
        Path(path).write_text(json.dumps(receipt, indent=2), encoding='utf-8')


def validate_owner(instance, health, listeners, receipt, process):
    expected_health = {'status': 'ok', 'instanceId': instance, 'authMode': 'google-only'}
    pid = receipt.get('pid')
    if (health != expected_health or receipt.get('status') != 'STARTED_HEALTHY'
            or type(pid) is not int or pid <= 0 or set(listeners) != {pid}
            or process.get('pid') != pid or process.get('name') != 'node'):
        raise ValueError('BACKEND_OWNER_NOT_VERIFIED')
    try:
        started = datetime.fromisoformat(process['startedAt'].replace('Z', '+00:00'))
        recorded = datetime.fromisoformat(receipt['utc'].replace('Z', '+00:00'))
        if not started.tzinfo or not recorded.tzinfo or not 0 <= (recorded - started).total_seconds() <= 60:
            raise ValueError('BACKEND_PROCESS_START_MISMATCH')
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError('BACKEND_PROCESS_START_MISSING') from error
    return pid
