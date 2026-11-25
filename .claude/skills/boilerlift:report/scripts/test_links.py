#!/usr/bin/env python3
"""Tests for links.py. Run: python3 test_links.py"""
from __future__ import annotations

import hashlib
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent / "links.py"
PR = "https://github.com/laurentvandelle/boilerlift/pull/73"
SHA = "623b488ecba4285961bff06e61c03ba8085a1db0"


def links(*args: str):
    proc = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


class LinksTest(unittest.TestCase):
    def test_should_pin_a_new_line_to_the_commit_with_the_path_hash(self):
        code, out, _ = links("--pr", PR, "--sha", SHA, "--path", "src/bin.ts", "--line", "12")
        anchor = hashlib.sha256(b"src/bin.ts").hexdigest()
        self.assertEqual(code, 0)
        self.assertEqual(out, f"{PR}/files/{SHA}#diff-{anchor}R12")

    def test_should_use_the_left_side_for_a_deleted_line(self):
        code, out, _ = links("--pr", PR, "--sha", SHA, "--path", "src/bin.ts", "--line", "3", "--side", "L")
        self.assertEqual(code, 0)
        self.assertTrue(out.endswith("L3"))

    def test_should_hash_the_known_digest_of_a_path_with_a_colon(self):
        path = ".claude/skills/boilerlift:report/SKILL.md"
        code, out, _ = links("--pr", PR + "/", "--sha", SHA.upper(), "--path", path, "--line", "1")
        self.assertEqual(code, 0)
        self.assertEqual(out, f"{PR}/files/{SHA}#diff-{hashlib.sha256(path.encode()).hexdigest()}R1")

    def test_should_fail_with_exit_2_when_the_input_is_not_usable(self):
        cases = [
            ("--pr", "https://github.com/a/b/issues/1", "--sha", SHA, "--path", "a", "--line", "1"),
            ("--pr", PR, "--sha", "623b488", "--path", "a", "--line", "1"),
            ("--pr", PR, "--sha", SHA, "--path", "/abs/a", "--line", "1"),
            ("--pr", PR, "--sha", SHA, "--path", "a", "--line", "0"),
            ("--pr", PR, "--sha", SHA, "--path", "a", "--line", "1", "--side", "X"),
        ]
        for args in cases:
            with self.subTest(args=args):
                code, out, err = links(*args)
                self.assertEqual(code, 2)
                self.assertEqual(out, "")
                self.assertTrue(err.startswith("error: "))


if __name__ == "__main__":
    unittest.main()
