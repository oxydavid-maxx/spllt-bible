"""Optional LINE webhook configuration must not prevent the core API from starting.

The pilot folder may hold line-runtime-config.json: {"channelSecretFile": "<absolute path>"}. The path is
passed to the server as QINGMU_LINE_SECRET_FILE; the secret itself is read only by the server
(server/lineWebhook.ts), never here. Missing or invalid configuration leaves the webhook off (404).
"""
import json
from pathlib import Path


def read_line_environment(path):
    path = Path(path)
    if not path.exists():
        return {}, 'NOT_CONFIGURED'
    try:
        config = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(config, dict):
            raise ValueError('INVALID_CONFIG')
        secret_file = config.get('channelSecretFile')
        if not isinstance(secret_file, str) or not Path(secret_file).is_absolute() or not Path(secret_file).is_file():
            raise ValueError('INVALID_CONFIG')
        return {'QINGMU_LINE_SECRET_FILE': secret_file}, 'CONFIGURED'
    except (OSError, ValueError, TypeError):
        return {}, 'INVALID_OPTIONAL_CONFIG'
