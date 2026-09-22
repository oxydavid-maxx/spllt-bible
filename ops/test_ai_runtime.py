import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from ai_runtime import read_ai_environment


class AiRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.boundary = self.root / 'server' / 'claudeCli.ts'
        self.boundary.parent.mkdir()
        self.boundary.write_text('verified isolated boundary', encoding='utf-8')
        self.executable = self.root / 'claude.exe'
        self.executable.write_bytes(b'fixture executable')
        self.config = self.root / 'ai-runtime.json'

    def write_config(self, **overrides):
        value = {
            'enabled': True,
            'executable': str(self.executable),
            'boundarySha256': hashlib.sha256(self.boundary.read_bytes()).hexdigest(),
        }
        value.update(overrides)
        self.config.write_text(json.dumps(value), encoding='utf-8')

    def test_missing_config_keeps_estimation_disabled(self):
        self.assertEqual(read_ai_environment(self.config, self.root), ({}, 'DISABLED'))

    def test_disabled_cannot_be_overridden_by_inherited_environment(self):
        self.write_config(enabled=False)
        self.assertEqual(read_ai_environment(self.config, self.root), ({}, 'DISABLED'))

    def test_only_verified_boundary_can_enable_estimation(self):
        self.write_config()
        self.assertEqual(read_ai_environment(self.config, self.root),
                         ({'QINGMU_CLAUDE_CLI_PATH': str(self.executable)}, 'ENABLED_VERIFIED'))

    def test_rollback_to_old_server_automatically_disables_estimation(self):
        self.write_config()
        self.boundary.write_text('unrestricted old implementation', encoding='utf-8')
        self.assertEqual(read_ai_environment(self.config, self.root), ({}, 'BOUNDARY_MISMATCH'))

    def test_malformed_and_wrong_types_fail_closed(self):
        for value in ('oops', '[]', '{"enabled":"true"}', '{"enabled":true}',
                      '{"enabled":true,"executable":"relative.exe","boundarySha256":"x"}'):
            with self.subTest(value=value):
                self.config.write_text(value, encoding='utf-8')
                self.assertEqual(read_ai_environment(self.config, self.root)[0], {})

    def test_missing_cli_cannot_enable_worker(self):
        self.write_config()
        self.executable.unlink()
        self.assertEqual(read_ai_environment(self.config, self.root), ({}, 'INVALID_CONFIG'))


if __name__ == '__main__':
    unittest.main()
