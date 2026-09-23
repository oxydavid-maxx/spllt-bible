"""Optional reminder configuration must not prevent the core API from starting."""
import json
from pathlib import Path
import re


def read_reminder_environment(path):
    disabled = {'QINGMU_REMINDER_WORKER_AUTOSTART': 'false'}
    path = Path(path)
    if not path.exists():
        return disabled, 'NOT_CONFIGURED'
    try:
        config = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(config, dict):
            raise ValueError('INVALID_CONFIG')
        project = config.get('projectId')
        credential = config.get('credentialFile')
        autostart = config.get('autostart', False)
        if not isinstance(project, str) or not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project):
            raise ValueError('INVALID_PROJECT')
        if not isinstance(credential, str) or not Path(credential).is_absolute() or not Path(credential).is_file() or not isinstance(autostart, bool):
            raise ValueError('INVALID_CONFIG')
        return {
            'QINGMU_FCM_PROJECT_ID': project,
            'QINGMU_FCM_CREDENTIAL_FILE': credential,
            'QINGMU_REMINDER_WORKER_AUTOSTART': 'true' if autostart else 'false',
        }, 'CONFIGURED_DISPATCHER_ON' if autostart else 'CONFIGURED_DISPATCHER_OFF'
    except (OSError, ValueError, TypeError):
        return disabled, 'INVALID_OPTIONAL_CONFIG'
