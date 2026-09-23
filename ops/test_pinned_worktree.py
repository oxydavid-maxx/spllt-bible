import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from pinned_worktree import preflight, preflight_against_declared_pin, read_declared_pin, WorktreeNotPinnedError


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


class DeclaredPinTests(unittest.TestCase):
    """Covers the gap a commit landing directly inside a live pinned worktree exposed
    on 2026-09-23: preflight() alone only proves a tree is consistent with its OWN
    HEAD, not that HEAD is the commit the deployment is declared to run. These tests
    use a real repo (git init/commit, a real second commit to simulate the drift) and a
    real pin-record JSON file living outside that repo, exactly like PILOT/
    pinned-commit.json would sit outside the pinned worktree in production.
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
        self.pinned_commit = self._head()
        self.pin_path = Path(self.temp.name) / 'pinned-commit.json'
        self.pin_path.write_text(json.dumps({'commit': self.pinned_commit}), encoding='utf-8')

    def _head(self):
        return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=str(self.repo), capture_output=True,
                               text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip()

    def test_head_matching_the_declared_pin_passes(self):
        self.assertEqual(preflight_against_declared_pin(self.repo, self.pin_path), self.pinned_commit)

    def test_a_new_commit_landed_directly_in_the_worktree_is_refused_even_though_clean(self):
        # This is exactly the 2026-09-23 scenario: a real, clean, committed change
        # lands straight in the worktree. `git status` reports nothing -- the tree is
        # internally consistent -- but HEAD has moved past what was declared.
        (self.repo / 'server.txt').write_text('a real, clean, committed change\n', encoding='utf-8')
        run_git(['add', 'server.txt'], self.repo)
        run_git(['commit', '-m', 'landed directly in the live worktree'], self.repo)
        new_head = self._head()
        self.assertNotEqual(new_head, self.pinned_commit)
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            preflight_against_declared_pin(self.repo, self.pin_path)
        self.assertEqual(ctx.exception.reason, 'COMMIT_MISMATCH')
        self.assertEqual(ctx.exception.detail['expected'], self.pinned_commit)
        self.assertEqual(ctx.exception.detail['actual'], new_head)

    def test_missing_pin_record_refuses_with_a_clear_reason(self):
        missing = Path(self.temp.name) / 'does-not-exist-pinned-commit.json'
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            preflight_against_declared_pin(self.repo, missing)
        self.assertEqual(ctx.exception.reason, 'PIN_RECORD_MISSING')

    def test_malformed_pin_record_refuses_with_a_clear_reason(self):
        for content in ('not json', '{}', '{"commit": "too-short"}', '{"commit": 12345}', '[]'):
            with self.subTest(content=content):
                self.pin_path.write_text(content, encoding='utf-8')
                with self.assertRaises(WorktreeNotPinnedError) as ctx:
                    read_declared_pin(self.pin_path)
                self.assertEqual(ctx.exception.reason, 'PIN_RECORD_INVALID')

    def test_dirty_tree_is_still_refused_even_when_head_matches_the_declared_pin(self):
        # The declared-pin check must not bypass the ordinary dirty-tree check.
        (self.repo / 'server.txt').write_text('edited live, nobody noticed\n', encoding='utf-8')
        with self.assertRaises(WorktreeNotPinnedError) as ctx:
            preflight_against_declared_pin(self.repo, self.pin_path)
        self.assertEqual(ctx.exception.reason, 'DIRTY_WORKTREE')

    def test_pin_record_commit_is_case_insensitive(self):
        self.pin_path.write_text(json.dumps({'commit': self.pinned_commit.upper()}), encoding='utf-8')
        self.assertEqual(preflight_against_declared_pin(self.repo, self.pin_path), self.pinned_commit)


if __name__ == '__main__':
    unittest.main()
