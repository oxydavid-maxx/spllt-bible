import unittest
import json
from pathlib import Path
import tempfile
from backend_owner import validate_owner, record_successful_start


class BackendOwnerTests(unittest.TestCase):
    def setUp(self):
        self.health = {'status': 'ok', 'instanceId': 'test-instance', 'authMode': 'google-only'}
        self.receipt = {'status': 'STARTED_HEALTHY', 'pid': 42, 'utc': '2026-09-22T07:00:01Z'}
        self.process = {'pid': 42, 'name': 'node', 'startedAt': '2026-09-22T07:00:00Z'}

    def verify(self, listeners=(42,)):
        return validate_owner('test-instance', self.health, listeners, self.receipt, self.process)

    def test_requires_matching_health_listener_receipt_and_process(self):
        self.assertEqual(self.verify(), 42)

    def test_rejects_reused_pid_from_another_start(self):
        self.process['startedAt'] = '2026-09-22T07:02:00Z'
        with self.assertRaises(ValueError):
            self.verify()

    def test_rejects_wrong_instance_or_unhealthy_backend(self):
        self.health['instanceId'] = 'another-product'
        with self.assertRaises(ValueError):
            self.verify()

    def test_rejects_changed_or_ambiguous_port_owner(self):
        for listeners in ((), (43,), (42, 43)):
            with self.subTest(listeners=listeners), self.assertRaises(ValueError):
                self.verify(listeners)

    def test_rejects_missing_process_or_receipt_and_non_node(self):
        self.process['name'] = 'python'
        with self.assertRaises(ValueError):
            self.verify()

    def test_already_running_does_not_erase_active_process_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'active-backend.json'
            record_successful_start(target, self.receipt)
            record_successful_start(target, {'status': 'ALREADY_RUNNING', 'utc': '2026-09-22T07:05:00Z'})
            self.assertTrue(target.exists(), 'a successful start needs a durable identity receipt')
            self.assertEqual(json.loads(target.read_text(encoding='utf-8')), self.receipt)
        self.process = {}
        with self.assertRaises(ValueError):
            self.verify()


if __name__ == '__main__':
    unittest.main()
