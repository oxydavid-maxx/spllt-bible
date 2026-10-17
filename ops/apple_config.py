"""Pass the optional Apple key pointer; only the backend reads the key.

apple-runtime-config.json: {"keyFile": "<absolute path to the .p8>", "keyId": "<10 characters>", "teamId": "<10 characters>"}.
One key serves both Sign in with Apple (token exchange and revocation on account deletion) and APNs
(iPhone friend pushes), so the same three values go to both groups of variables.
Missing or invalid configuration leaves both off: Apple sign-in still verifies identity tokens, deletion
logs that the Apple token was not revoked, and no iPhone push is sent.
"""
import json
import re
from pathlib import Path

APPLE_ID = re.compile(r'^[A-Z0-9]{10}$')


def read_apple_environment(path):
    path = Path(path)
    if not path.exists():
        return {}, 'NOT_CONFIGURED'
    try:
        config = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(config, dict):
            raise ValueError('INVALID_CONFIG')
        key_file, key_id, team_id = config.get('keyFile'), config.get('keyId'), config.get('teamId')
        if not isinstance(key_file, str) or not Path(key_file).is_absolute() or not Path(key_file).is_file():
            raise ValueError('INVALID_CONFIG')
        if not isinstance(key_id, str) or not APPLE_ID.match(key_id) or not isinstance(team_id, str) or not APPLE_ID.match(team_id):
            raise ValueError('INVALID_CONFIG')
        return {
            'QINGMU_APPLE_SIGNIN_KEY_FILE': key_file, 'QINGMU_APPLE_SIGNIN_KEY_ID': key_id, 'QINGMU_APPLE_SIGNIN_TEAM_ID': team_id,
            'QINGMU_APNS_KEY_FILE': key_file, 'QINGMU_APNS_KEY_ID': key_id, 'QINGMU_APNS_TEAM_ID': team_id,
        }, 'CONFIGURED'
    except (OSError, ValueError, TypeError):
        return {}, 'INVALID_OPTIONAL_CONFIG'
