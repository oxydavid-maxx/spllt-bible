import json
from pathlib import Path
import tempfile
import unittest

from azure_speech_config import read_azure_speech_environment


class AzureSpeechConfigurationTest(unittest.TestCase):
    def test_optional_pointer_passes_only_path_without_reading_key(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'azure-speech-runtime-config.json'
            self.assertEqual(read_azure_speech_environment(config), ({}, 'NOT_CONFIGURED'))
            secret = Path(directory) / 'speech.json'
            secret.write_text('not JSON: launcher must not read secret bytes', encoding='utf-8')
            config.write_text(json.dumps({'speechFile': str(secret)}), encoding='utf-8')
            self.assertEqual(read_azure_speech_environment(config), ({'QINGMU_AZURE_SPEECH_FILE': str(secret)}, 'CONFIGURED'))

    def test_invalid_optional_config_never_breaks_core_startup(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'azure-speech-runtime-config.json'
            for value in ['bad', '[]', '{"speechFile":"relative.json"}', json.dumps({'speechFile': str(Path(directory) / 'missing.json')})]:
                config.write_text(value, encoding='utf-8')
                self.assertEqual(read_azure_speech_environment(config), ({}, 'INVALID_OPTIONAL_CONFIG'))
