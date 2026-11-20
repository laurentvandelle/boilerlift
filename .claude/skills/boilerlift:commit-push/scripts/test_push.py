#!/usr/bin/env python3
"""Tests for push.py against temporary repos and a local bare remote. Run: python3 test_push.py"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent / "push.py"
ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
       "GIT_COMMITTER_EMAIL": "t@t", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, env=ENV, check=True, capture_output=True, text=True).stdout.strip()


def commit(repo: Path, name: str, text: str) -> None:
    (repo / name).write_text(text)
    git(repo, "add", name)
    git(repo, "commit", "-q", "-m", f"chore: {name}")


def push(repo: Path, *flags: str):
    proc = subprocess.run([sys.executable, str(SCRIPT), "--repo", str(repo), *flags],
                          env=ENV, capture_output=True, text=True)
    return proc.returncode, json.loads(proc.stdout) if proc.stdout.strip() else {}, proc.stderr


class PushTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.remote = root / "remote.git"
        git(root, "init", "-q", "--bare", "-b", "master", str(self.remote))
        self.a = root / "a"
        git(root, "clone", "-q", str(self.remote), str(self.a))
        git(self.a, "checkout", "-q", "-b", "master")
        commit(self.a, "base.txt", "base\n")
        git(self.a, "push", "-q", "-u", "origin", "master")
        self.b = root / "b"
        git(root, "clone", "-q", str(self.remote), str(self.b))

    def tearDown(self):
        self.tmp.cleanup()

    def test_up_to_date(self):
        code, data, _ = push(self.a)
        self.assertEqual((code, data["status"], data["commits"]), (0, "up_to_date", []))

    def test_push_on_master(self):
        commit(self.a, "one.txt", "1\n")
        code, data, _ = push(self.a)
        self.assertEqual((code, data["status"], data["upstream_set"]), (0, "pushed", False))
        self.assertEqual(len(data["commits"]), 1)
        self.assertEqual(git(self.remote, "log", "-1", "--format=%s", "master"), "chore: one.txt")

    def test_new_branch_sets_upstream(self):
        git(self.a, "checkout", "-q", "-b", "feature/x")
        commit(self.a, "x.txt", "x\n")
        code, data, _ = push(self.a)
        self.assertEqual((code, data["status"], data["upstream_set"]), (0, "pushed", True))
        self.assertEqual(git(self.a, "rev-parse", "--abbrev-ref", "@{u}"), "origin/feature/x")

    def test_dry_run_pushes_nothing(self):
        commit(self.a, "one.txt", "1\n")
        code, data, _ = push(self.a, "--dry-run")
        self.assertEqual((code, data["status"]), (0, "dry_run"))
        self.assertEqual(git(self.remote, "log", "-1", "--format=%s", "master"), "chore: base.txt")

    def test_rebases_on_non_fast_forward(self):
        commit(self.b, "remote.txt", "r\n")
        git(self.b, "push", "-q")
        commit(self.a, "local.txt", "l\n")
        (self.a / "base.txt").write_text("dirty\n")  # leftover change must survive via autostash
        code, data, _ = push(self.a)
        self.assertEqual((code, data["status"], data["rebased"]), (0, "pushed", True))
        self.assertEqual(git(self.remote, "log", "--format=%s", "master").splitlines()[:2],
                         ["chore: local.txt", "chore: remote.txt"])
        self.assertEqual((self.a / "base.txt").read_text(), "dirty\n")

    def test_conflict_aborts_rebase(self):
        commit(self.b, "base.txt", "theirs\n")
        git(self.b, "push", "-q")
        commit(self.a, "base.txt", "ours\n")
        code, data, err = push(self.a)
        self.assertEqual(code, 6, err)
        self.assertEqual(data["conflicts"], ["base.txt"])
        self.assertFalse((Path(git(self.a, "rev-parse", "--absolute-git-dir")) / "rebase-merge").exists())
        self.assertEqual(git(self.a, "log", "-1", "--format=%s"), "chore: base.txt")
        self.assertEqual((self.a / "base.txt").read_text(), "ours\n")

    def test_new_branch_without_commits_still_pushed(self):
        git(self.a, "checkout", "-q", "-b", "feature/empty")
        code, data, _ = push(self.a)
        self.assertEqual((code, data["status"], data["upstream_set"]), (0, "pushed", True))
        self.assertIn("feature/empty", git(self.remote, "branch"))

    def test_hook_rejection_is_exit_5(self):
        hook = self.a / ".git" / "hooks" / "pre-push"
        hook.write_text("#!/bin/sh\necho blocked >&2\nexit 1\n")
        hook.chmod(0o755)
        commit(self.a, "one.txt", "1\n")
        code, _, err = push(self.a)
        self.assertEqual(code, 5, err)

    def test_autostash_conflict_warns(self):
        commit(self.b, "base.txt", "theirs\n")
        git(self.b, "push", "-q")
        commit(self.a, "local.txt", "l\n")
        (self.a / "base.txt").write_text("dirty\n")
        code, data, err = push(self.a)
        self.assertEqual((code, data["status"], data["rebased"]), (0, "pushed", True), err)
        self.assertIn("git stash", data["warnings"][0])
        self.assertTrue(git(self.a, "stash", "list"))

    def test_no_remote(self):
        git(self.a, "remote", "remove", "origin")
        code, _, err = push(self.a)
        self.assertEqual(code, 3)
        self.assertIn("does not exist", err)

    def test_detached_head(self):
        git(self.a, "checkout", "-q", "--detach")
        code, _, err = push(self.a)
        self.assertEqual(code, 3)
        self.assertIn("detached HEAD", err)

    def test_not_a_repo(self):
        code, _, _ = push(Path(self.tmp.name))
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
