"""Proves the migrated official entry (ops/start_backend.py) refuses to start from a
real dirty git worktree, and does not refuse a clean one -- using an actual `git init` +
`git commit` copy of the real ops/ files (not a stub), run as the real subprocess a
Windows logon would run.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REAL_OPS = Path(__file__).resolve().parent
COPIED_FILES = ['start_backend.py', 'deployment_support.py', 'pinned_worktree.py',
                 'backend_owner.py', 'reminder_config.py', 'ai_runtime.py']


def run_git(args, cwd):
    subprocess.run(['git', *args], cwd=str(cwd), check=True, capture_output=True, text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW)


class StartBackendPinTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        (self.repo / 'ops').mkdir(parents=True)
        for name in COPIED_FILES:
            shutil.copy(REAL_OPS / name, self.repo / 'ops' / name)
        run_git(['init', '--initial-branch=main'], self.repo)
        run_git(['config', 'user.email', 'test@example.invalid'], self.repo)
        run_git(['config', 'user.name', 'Test'], self.repo)
        run_git(['add', '.'], self.repo)
        run_git(['commit', '-m', 'initial commit'], self.repo)
        self.pinned_commit = subprocess.run(
            ['git', 'rev-parse', 'HEAD'], cwd=str(self.repo), capture_output=True, text=True,
            check=True, creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout.strip()
        self.pilot_scratch = Path(self.temp.name) / 'pilot-scratch'
        self.pilot_scratch.mkdir()
        (self.pilot_scratch / 'pinned-commit.json').write_text(
            json.dumps({'commit': self.pinned_commit}), encoding='utf-8')
        self.receipt_path = self.repo / 'ops' / 'last-startup-result.json'

    def invoke(self):
        env = dict(os.environ)
        # Distinct scratch port per test class so the named mutex never collides with a
        # real production start (port 8788) or with another test run.
        env['QINGMU_SERVER_PORT_OVERRIDE'] = '18788'
        env['QINGMU_PILOT_DIR_OVERRIDE'] = str(self.pilot_scratch)
        # This temp repo has no .gitignore; without this, importing pinned_worktree.py
        # would write __pycache__/*.pyc into ops/ on the very first invocation and make
        # the "clean" case look dirty from its own side effect, not from a real edit.
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        return subprocess.run(
            [sys.executable, str(self.repo / 'ops' / 'start_backend.py')],
            cwd=str(self.repo), env=env, capture_output=True, text=True, timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )

    def read_receipt(self):
        return json.loads(self.receipt_path.read_text(encoding='utf-8'))

    def test_dirty_tracked_file_is_refused_before_any_secret_is_touched(self):
        (self.repo / 'ops' / 'reminder_config.py').write_text(
            (self.repo / 'ops' / 'reminder_config.py').read_text(encoding='utf-8') + '\n# edited live, nobody noticed\n',
            encoding='utf-8',
        )
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        receipt = self.read_receipt()
        self.assertEqual(receipt['status'], 'REFUSED')
        self.assertEqual(receipt['reason'], 'DIRTY_WORKTREE')
        # No pilot-private-config.json exists in the scratch PILOT dir; if the refusal
        # came from anywhere past preflight(), deployment_support.py would have crashed
        # instead trying to read it, and the receipt status would be FAILED, not REFUSED.
        self.assertFalse((self.pilot_scratch / 'pilot-private-config.json').exists())

    def test_untracked_file_is_refused(self):
        (self.repo / 'ops' / 'extra_untracked.py').write_text('# never committed\n', encoding='utf-8')
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        receipt = self.read_receipt()
        self.assertEqual(receipt['status'], 'REFUSED')
        self.assertEqual(receipt['reason'], 'DIRTY_WORKTREE')

    def test_clean_worktree_is_not_refused_by_the_git_check(self):
        # No real pilot-private-config.json in the scratch PILOT dir, so this run cannot
        # reach STARTED_HEALTHY -- but the failure it does hit must be downstream of the
        # git check (FAILED), never REFUSED, proving preflight() passed a clean tree
        # through instead of always refusing / never actually being reached.
        result = self.invoke()
        receipt = self.read_receipt()
        self.assertNotEqual(receipt['status'], 'REFUSED', msg=receipt)
        self.assertEqual(receipt['status'], 'FAILED')

    def test_a_new_commit_landed_directly_in_the_worktree_is_refused_with_commit_mismatch(self):
        # The exact 2026-09-23 scenario, exercised against the real start_backend.py
        # subprocess: a genuinely clean, committed change lands straight in the
        # worktree (not a dirty edit). `git status` reports nothing, but HEAD has moved
        # past the commit pinned-commit.json declares.
        (self.repo / 'ops' / 'reminder_config.py').write_text(
            (self.repo / 'ops' / 'reminder_config.py').read_text(encoding='utf-8') + '\n# a real, clean, committed change\n',
            encoding='utf-8',
        )
        run_git(['add', '.'], self.repo)
        run_git(['commit', '-m', 'landed directly in the live worktree'], self.repo)
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        receipt = self.read_receipt()
        self.assertEqual(receipt['status'], 'REFUSED')
        self.assertEqual(receipt['reason'], 'COMMIT_MISMATCH')
        self.assertEqual(receipt['detail']['expected'], self.pinned_commit)
        self.assertNotEqual(receipt['detail']['actual'], self.pinned_commit)
        # Confirms the check happened before any secret was touched, same as the
        # dirty-tree cases.
        self.assertFalse((self.pilot_scratch / 'pilot-private-config.json').exists())

    def test_missing_pin_record_is_refused_with_a_clear_reason(self):
        (self.pilot_scratch / 'pinned-commit.json').unlink()
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        receipt = self.read_receipt()
        self.assertEqual(receipt['status'], 'REFUSED')
        self.assertEqual(receipt['reason'], 'PIN_RECORD_MISSING')


if __name__ == '__main__':
    unittest.main()
