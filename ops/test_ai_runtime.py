import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from ai_runtime import read_ai_environment, read_committed_boundary_bytes


def run_git(args, cwd):
    subprocess.run(['git', *args], cwd=str(cwd), check=True, capture_output=True, text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW)


class AiRuntimeTests(unittest.TestCase):
    """`live_root` is a real `git init`/`commit` repo throughout, not a bare temp
    directory: read_ai_environment() hashes the committed git blob for
    server/claudeCli.ts, not the working-tree file, precisely so that the pin is
    invariant to local line-ending settings (core.autocrlf) -- see
    read_committed_boundary_bytes()'s docstring for the 2026-09-23 incident this fixes.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        run_git(['init', '--initial-branch=main'], self.root)
        run_git(['config', 'user.email', 'test@example.invalid'], self.root)
        run_git(['config', 'user.name', 'Test'], self.root)
        self.boundary = self.root / 'server' / 'claudeCli.ts'
        self.boundary.parent.mkdir()
        self.boundary.write_bytes(b'verified isolated boundary\n')
        run_git(['add', 'server/claudeCli.ts'], self.root)
        run_git(['commit', '-m', 'add boundary'], self.root)
        self.executable = self.root / 'claude.exe'
        self.executable.write_bytes(b'fixture executable')
        self.config = self.root / 'ai-runtime.json'

    def committed_pin(self):
        return hashlib.sha256(read_committed_boundary_bytes(self.root)).hexdigest()

    def write_config(self, **overrides):
        value = {
            'enabled': True,
            'executable': str(self.executable),
            'boundarySha256': self.committed_pin(),
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

    def test_identical_content_different_line_endings_yields_same_status_and_hash(self):
        """The acceptance case for the 2026-09-23 fix: CRLF vs LF *working-tree* copies
        of the identical committed content must yield the same ENABLED_VERIFIED status
        against the same pin, because the pin is checked against the committed blob,
        never the on-disk bytes."""
        self.write_config()
        # Baseline: working tree still has the LF bytes exactly as committed.
        self.assertEqual(read_ai_environment(self.config, self.root)[1], 'ENABLED_VERIFIED')
        # Now simulate a checkout with core.autocrlf=true (or the old mixed-CRLF
        # untracked copy): rewrite the on-disk file to CRLF, same content, without
        # touching git at all -- git status on a real autocrlf checkout would call this
        # clean; here it is not even checked, since read_ai_environment never opens
        # this file.
        self.boundary.write_bytes(b'verified isolated boundary\r\n')
        env, status = read_ai_environment(self.config, self.root)
        self.assertEqual(status, 'ENABLED_VERIFIED')
        self.assertEqual(env, {'QINGMU_CLAUDE_CLI_PATH': str(self.executable)})

    def test_real_content_change_in_the_committed_blob_is_still_detected(self):
        """The other half of the acceptance case: a pin from an old commit must still
        be rejected once the committed content (not just its line endings) actually
        changes -- the fix must not turn into "never verify anything"."""
        self.write_config()
        self.boundary.write_bytes(b'unrestricted old implementation\n')
        run_git(['add', 'server/claudeCli.ts'], self.root)
        run_git(['commit', '-m', 'rollback to old server'], self.root)
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

    def test_non_git_live_root_fails_closed(self):
        # read_committed_boundary_bytes requires live_root to be a git worktree; every
        # real caller (deployment_support.launch()) only reaches this after
        # pinned_worktree.preflight() already confirmed that, but a non-git live_root
        # must still fail closed rather than crash the caller.
        with tempfile.TemporaryDirectory() as not_a_repo:
            config = Path(not_a_repo) / 'ai-runtime.json'
            config.write_text(json.dumps({
                'enabled': True, 'executable': str(self.executable), 'boundarySha256': 'a' * 64,
            }), encoding='utf-8')
            self.assertEqual(read_ai_environment(config, not_a_repo), ({}, 'INVALID_CONFIG'))


if __name__ == '__main__':
    unittest.main()
