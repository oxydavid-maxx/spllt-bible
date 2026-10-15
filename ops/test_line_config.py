import json
from pathlib import Path
import tempfile
import unittest

from line_config import read_line_environment


class LineConfigurationTest(unittest.TestCase):
    def test_missing_optional_configuration_leaves_the_webhook_off(self):
        with tempfile.TemporaryDirectory() as directory:
            env, status = read_line_environment(Path(directory) / 'absent.json')
        self.assertEqual(env, {})
        self.assertEqual(status, 'NOT_CONFIGURED')

    def test_valid_pointer_is_passed_without_reading_the_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            secret = Path(directory) / 'line-bot.json'
            secret.write_text('not the secret; the configuration reader must not parse it')
            config = Path(directory) / 'line-runtime-config.json'
            config.write_text(json.dumps({'channelSecretFile': str(secret)}))
            env, status = read_line_environment(config)
        self.assertEqual(status, 'CONFIGURED')
        self.assertEqual(env, {'QINGMU_LINE_SECRET_FILE': str(secret)})

    def test_invalid_optional_configuration_cannot_take_down_the_core_api(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'line-runtime-config.json'
            for value in ['not json', json.dumps([]), json.dumps({'channelSecretFile': 'relative.json'}), json.dumps({'channelSecretFile': str(Path(directory) / 'absent.json')})]:
                config.write_text(value)
                env, status = read_line_environment(config)
                self.assertEqual(env, {})
                self.assertEqual(status, 'INVALID_OPTIONAL_CONFIG')


if __name__ == '__main__':
    unittest.main()
