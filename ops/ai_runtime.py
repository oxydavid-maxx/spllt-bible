"""Opt-in estimation policy; stale or absent configuration never enables a worker."""
import hashlib
import json
from pathlib import Path
import re

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
        actual = hashlib.sha256((Path(live_root) / 'server' / 'claudeCli.ts').read_bytes()).hexdigest()
        if actual != expected:
            return {}, 'BOUNDARY_MISMATCH'
        return {'QINGMU_CLAUDE_CLI_PATH': executable}, 'ENABLED_VERIFIED'
    except (OSError, ValueError, TypeError):
        return {}, 'INVALID_CONFIG'
