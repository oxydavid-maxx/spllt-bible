import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pinned_worktree import WorktreeNotPinnedError
import start_pinned_backend as spb


def run_git(args, cwd):
    subprocess.run(['git', *args], cwd=str(cwd), check=True, capture_output=True, text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW)


class MakeReceiptTests(unittest.TestCase):
    def test_receipt_contains_full_commit_sha_and_is_json_serializable(self):
        commit = 'a' * 40
        receipt = spb.make_receipt('STARTED_HEALTHY', pid=123, commit=commit, port=8799)
        self.assertEqual(receipt['commit'], commit)
        self.assertEqual(len(receipt['commit']), 40)
        self.assertIn('utc', receipt)
        json.dumps(receipt)  # must not raise


class BuildEnvTests(unittest.TestCase):
    def test_keeps_only_the_safe_keep_list_plus_explicit_extras(self):
        base = {'SystemRoot': 'C:\\Windows', 'SOME_UNRELATED_SECRET': 'do-not-leak', 'TEMP': 'C:\\Temp'}
        env = spb.build_env(base, {'QINGMU_INSTANCE_ID': 'test'}, node_dir=Path('C:/nodefake'))
        self.assertNotIn('SOME_UNRELATED_SECRET', env)
        self.assertEqual(env['SystemRoot'], 'C:\\Windows')
        self.assertEqual(env['QINGMU_INSTANCE_ID'], 'test')
        self.assertTrue(env['PATH'].startswith('C:/nodefake'.replace('/', '\\')) or 'nodefake' in env['PATH'])

    def test_case_insensitive_keep_list_match(self):
        # A real dry run on this machine failed here: the parent shell stored the
        # variable as 'SYSTEMROOT' (all caps) while DEFAULT_KEEP_ENV says 'SystemRoot';
        # a case-sensitive dict lookup silently dropped it, and node crashed at startup
        # with 'Assertion failed: ncrypto::CSPRNG' for want of %SystemRoot%.
        base = {'SYSTEMROOT': 'C:\\WINDOWS', 'windir': 'C:\\WINDOWS'}
        env = spb.build_env(base, {}, node_dir=Path('C:/nodefake'))
        self.assertEqual(env.get('SystemRoot'), 'C:\\WINDOWS')
        self.assertEqual(env.get('WINDIR'), 'C:\\WINDOWS')


class ParseEnvArgsTests(unittest.TestCase):
    def test_parses_key_value_pairs(self):
        self.assertEqual(spb.parse_env_args(['A=1', 'B=two=fields']), {'A': '1', 'B': 'two=fields'})

    def test_rejects_pair_without_equals(self):
        with self.assertRaises(ValueError):
            spb.parse_env_args(['NOVALUE'])

    def test_rejects_empty_key(self):
        with self.assertRaises(ValueError):
            spb.parse_env_args(['=value'])

    def test_empty_list_is_fine(self):
        self.assertEqual(spb.parse_env_args([]), {})
        self.assertEqual(spb.parse_env_args(None), {})


class StartRefusalReachesGitCheckTests(unittest.TestCase):
    """Confirms start() consults pinned_worktree.preflight() for real (a real dirty git
    repo, not a stub) and refuses before ever invoking node. A bogus, nonexistent
    `node=` path is passed in deliberately: if the git check were skipped or
    short-circuited, the failure actually observed would be RuntimeError('NODE_NOT_FOUND'),
    not WorktreeNotPinnedError -- so asserting the exact exception type and reason
    proves the dirty-tree branch, specifically, was reached and fired first."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()
        run_git(['init', '--initial-branch=main'], self.repo)
        run_git(['config', 'user.email', 'test@example.invalid'], self.repo)
        run_git(['config', 'user.name', 'Test'], self.repo)
        (self.repo / 'server').mkdir()
        (self.repo / 'server' / 'http.ts').write_text('// fixture entry\n', encoding='utf-8')
        run_git(['add', '.'], self.repo)
        run_git(['commit', '-m', 'initial commit'], self.repo)
        self.nonexistent_node = Path(self.temp.name) / 'no-such-node.exe'

    def test_dirty_tree_is_refused_before_the_node_existence_check(self):
        (self.repo / 'server' / 'http.ts').write_text('// edited live, nobody noticed\n', encoding='utf-8')
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            spb.start(self.repo, 8799, 'test-instance', {}, node=self.nonexistent_node)
        self.assertEqual(ctx.exception.reason, 'DIRTY_WORKTREE')

    def test_untracked_file_is_refused_before_the_node_existence_check(self):
        (self.repo / 'server' / 'extra.ts').write_text('// never committed\n', encoding='utf-8')
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            spb.start(self.repo, 8799, 'test-instance', {}, node=self.nonexistent_node)
        self.assertEqual(ctx.exception.reason, 'DIRTY_WORKTREE')

    def test_clean_tree_with_missing_node_fails_downstream_of_the_git_check(self):
        # Sanity check for the two tests above: on a CLEAN tree, the same nonexistent
        # node path produces NODE_NOT_FOUND, not a git refusal -- proving preflight()
        # really does pass clean trees through to the node stage.
        with self.assertRaises(RuntimeError) as ctx:
            spb.start(self.repo, 8799, 'test-instance', {}, node=self.nonexistent_node)
        self.assertIn('NODE_NOT_FOUND', str(ctx.exception))


class MainCliRefusalTests(unittest.TestCase):
    """Exercises the real CLI entry point end to end against a real dirty git repo."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()
        run_git(['init', '--initial-branch=main'], self.repo)
        run_git(['config', 'user.email', 'test@example.invalid'], self.repo)
        run_git(['config', 'user.name', 'Test'], self.repo)
        (self.repo / 'server.txt').write_text('committed\n', encoding='utf-8')
        run_git(['add', '.'], self.repo)
        run_git(['commit', '-m', 'initial'], self.repo)
        self.receipt_path = Path(self.temp.name) / 'receipt.json'

    def invoke(self):
        script = Path(__file__).resolve().parent / 'start_pinned_backend.py'
        return subprocess.run(
            [sys.executable, str(script), '--worktree', str(self.repo), '--port', '8799',
             '--instance-id', 'test-instance', '--receipt', str(self.receipt_path)],
            capture_output=True, text=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW,
        )

    def test_dirty_worktree_refuses_via_the_real_cli_and_writes_a_receipt(self):
        (self.repo / 'server.txt').write_text('edited live\n', encoding='utf-8')
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0, msg=result.stdout + result.stderr)
        receipt = json.loads(self.receipt_path.read_text(encoding='utf-8'))
        self.assertEqual(receipt['status'], 'REFUSED')
        self.assertEqual(receipt['reason'], 'DIRTY_WORKTREE')

    def test_clean_worktree_reaches_node_launch_attempt_not_the_git_refusal(self):
        # No real node/server here -- this only proves preflight passed (no DIRTY_WORKTREE
        # / NOT_A_GIT_WORKTREE refusal) and the failure that does occur is downstream of
        # git, i.e. FAILED with a node/health error, never REFUSED.
        result = self.invoke()
        receipt = json.loads(self.receipt_path.read_text(encoding='utf-8'))
        self.assertNotEqual(receipt['status'], 'REFUSED', msg=receipt)


if __name__ == '__main__':
    unittest.main()
