"""Pass the optional Speech secret-file pointer; only the backend reads the key.

azure-speech-runtime-config.json: {"speechFile": "<absolute path>"}.
The target file holds {"key": "...", "region": "eastasia"}.
Missing or invalid configuration leaves devotional audio off (404).
"""
import json
from pathlib import Path


def read_azure_speech_environment(path):
    path = Path(path)
    if not path.exists():
        return {}, 'NOT_CONFIGURED'
    try:
        config = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(config, dict):
            raise ValueError('INVALID_CONFIG')
        speech_file = config.get('speechFile')
        if not isinstance(speech_file, str) or not Path(speech_file).is_absolute() or not Path(speech_file).is_file():
            raise ValueError('INVALID_CONFIG')
        return {'QINGMU_AZURE_SPEECH_FILE': speech_file}, 'CONFIGURED'
    except (OSError, ValueError, TypeError):
        return {}, 'INVALID_OPTIONAL_CONFIG'
