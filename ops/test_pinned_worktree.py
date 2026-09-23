import subprocess
import tempfile
import unittest
from pathlib import Path

from pinned_worktree import preflight, WorktreeNotPinnedError


def run_git(args, cwd):
    subprocess.run(['git', *args], cwd=str(cwd), check=True, capture_output=True, text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW)


class PinnedWorktreeTests(unittest.TestCase):
    """Every dirty/clean case here uses a real `git init` + `git commit` repo (not a
    stub or a mocked subprocess) so the assertions exercise the actual git plumbing,
    matching how a real pinned worktree under C:\\dev\\machine\\worktrees would behave.
    """

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()
        run_git(['init', '--initial-branch=main'], self.repo)
        run_git(['config', 'user.email', 'test@example.invalid'], self.repo)
        run_git(['config', 'user.name', 'Test'], self.repo)
        (self.repo / 'server.txt').write_text('original content\n', encoding='utf-8')
        run_git(['add', 'server.txt'], self.repo)
        run_git(['commit', '-m', 'initial commit'], self.repo)
        self.head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=str(self.repo),
                                    capture_output=True, text=True, check=True,
                                    creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip()

    def test_clean_pinned_tree_passes_preflight(self):
        commit = preflight(self.repo)
        self.assertEqual(commit, self.head)
        self.assertEqual(len(commit), 40)

    def test_clean_tree_matching_expected_commit_passes(self):
        self.assertEqual(preflight(self.repo, expected_commit=self.head), self.head)

    def test_refusal_reaches_dirty_check_for_a_modified_tracked_file(self):
        # The repo is real and was clean a moment ago (proved by the setUp commit
        # succeeding and by test_clean_pinned_tree_passes_preflight on a sibling repo);
        # only the tracked file's content changes here. If the raised reason were
        # anything other than DIRTY_WORKTREE (e.g. NOT_A_GIT_WORKTREE), that would mean
        # some earlier check short-circuited before actually inspecting `git status`.
        (self.repo / 'server.txt').write_text('edited live, nobody noticed\n', encoding='utf-8')
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            preflight(self.repo)
        self.assertEqual(ctx.exception.reason, 'DIRTY_WORKTREE')
        self.assertTrue(any('server.txt' in line for line in ctx.exception.detail))

    def test_refusal_reaches_dirty_check_for_an_untracked_file(self):
        (self.repo / 'new_file.txt').write_text('not committed\n', encoding='utf-8')
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            preflight(self.repo)
        self.assertEqual(ctx.exception.reason, 'DIRTY_WORKTREE')
        self.assertTrue(any('new_file.txt' in line for line in ctx.exception.detail))

    def test_refusal_reaches_dirty_check_for_a_staged_but_uncommitted_change(self):
        (self.repo / 'server.txt').write_text('staged edit\n', encoding='utf-8')
        run_git(['add', 'server.txt'], self.repo)
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            preflight(self.repo)
        self.assertEqual(ctx.exception.reason, 'DIRTY_WORKTREE')

    def test_commit_mismatch_is_refused_on_an_otherwise_clean_tree(self):
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            preflight(self.repo, expected_commit='f' * 40)
        self.assertEqual(ctx.exception.reason, 'COMMIT_MISMATCH')

    def test_not_a_git_directory_is_a_distinct_reason_from_dirty(self):
        plain = Path(self.temp.name) / 'not-a-repo'
        plain.mkdir()
        (plain / 'file.txt').write_text('x', encoding='utf-8')
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            preflight(plain)
        self.assertEqual(ctx.exception.reason, 'NOT_A_GIT_WORKTREE')

    def test_nonexistent_path_raises(self):
        with self.assertRaises(FileNotFoundError):
            preflight(Path(self.temp.name) / 'does-not-exist')


if __name__ == '__main__':
    unittest.main()
