import json
from pathlib import Path
import tempfile
import unittest

from reminder_config import read_reminder_environment


class ReminderConfigurationTest(unittest.TestCase):
    def test_missing_optional_configuration_keeps_dispatcher_off(self):
        with tempfile.TemporaryDirectory() as directory:
            env, status = read_reminder_environment(Path(directory) / 'absent.json')
        self.assertEqual(env, {'QINGMU_REMINDER_WORKER_AUTOSTART': 'false'})
        self.assertEqual(status, 'NOT_CONFIGURED')

    def test_valid_pointer_is_mapped_without_reading_credential_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / 'credential.json'
            key.write_text('not credential contents; the configuration reader must not parse it')
            config = Path(directory) / 'config.json'
            config.write_text(json.dumps({'projectId': 'qingmu-test', 'credentialFile': str(key), 'autostart': False}))
            env, status = read_reminder_environment(config)
            self.assertEqual(status, 'CONFIGURED_DISPATCHER_OFF')
            self.assertEqual(env['QINGMU_FCM_CREDENTIAL_FILE'], str(key))
            self.assertEqual(env['QINGMU_REMINDER_WORKER_AUTOSTART'], 'false')
            self.assertNotIn('not credential contents', json.dumps(env))
            config.write_text(json.dumps({'projectId': 'qingmu-test', 'credentialFile': str(key), 'autostart': True}))
            enabled, status = read_reminder_environment(config)
            self.assertEqual(enabled['QINGMU_REMINDER_WORKER_AUTOSTART'], 'true')
            self.assertEqual(status, 'CONFIGURED_DISPATCHER_ON')

    def test_invalid_optional_configuration_cannot_take_down_core_api_or_enable_sender(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'config.json'
            for value in ['not json', json.dumps({'projectId': 'qingmu-test', 'credentialFile': 'relative.json', 'autostart': True}), json.dumps({'projectId': 'qingmu-test', 'credentialFile': str(Path(directory) / 'absent'), 'autostart': True})]:
                config.write_text(value)
                env, status = read_reminder_environment(config)
                self.assertEqual(env, {'QINGMU_REMINDER_WORKER_AUTOSTART': 'false'})
                self.assertEqual(status, 'INVALID_OPTIONAL_CONFIG')


if __name__ == '__main__':
    unittest.main()
