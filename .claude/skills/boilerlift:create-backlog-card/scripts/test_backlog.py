#!/usr/bin/env python3
"""Unit tests for the pure helpers of backlog.py (no gh, no network).

Run from the repository root:
  python3 -m unittest discover -s .claude/skills/boilerlift:create-backlog-card/scripts
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import backlog  # noqa: E402


class IssueNumberTest(unittest.TestCase):
    def test_should_read_the_number_when_given_a_number_a_hash_or_the_url(self):
        refs = ["12", "#12", " 12 ", "https://github.com/laurentvandelle/boilerlift/issues/12",
                "https://github.com/laurentvandelle/boilerlift/issues/12#issuecomment-1"]

        numbers = [backlog.issue_number(r) for r in refs]

        self.assertEqual(numbers, [12] * len(refs))

    def test_should_refuse_when_the_url_is_another_repository(self):
        ref = "https://github.com/someone/else/issues/12"

        with self.assertRaises(backlog.Fail) as ctx:
            backlog.issue_number(ref)

        self.assertEqual(ctx.exception.code, 2)

    def test_should_refuse_when_the_url_is_a_pull_request(self):
        ref = "https://github.com/laurentvandelle/boilerlift/pull/12"

        with self.assertRaises(backlog.Fail):
            backlog.issue_number(ref)


class StatusAllowedTest(unittest.TestCase):
    def test_should_allow_when_the_card_has_no_status_yet(self):
        allowed = backlog.status_allowed(None, ["Backlog"])

        self.assertTrue(allowed)

    def test_should_allow_when_the_status_is_listed_in_any_case(self):
        allowed = backlog.status_allowed("ready", ["Backlog", "Ready"])

        self.assertTrue(allowed)

    def test_should_skip_when_the_card_is_already_further_on(self):
        allowed = backlog.status_allowed("In review", ["Backlog", "Ready"])

        self.assertFalse(allowed)

    def test_should_allow_when_no_only_from_is_given(self):
        allowed = backlog.status_allowed("Done", [])

        self.assertTrue(allowed)


class BlockersToAddTest(unittest.TestCase):
    def test_should_keep_the_order_and_drop_repeats_when_given_several_blockers(self):
        todo = backlog.blockers_to_add(40, [38, 36, 38], [])

        self.assertEqual(todo, [38, 36])

    def test_should_skip_a_blocker_when_the_link_already_exists(self):
        todo = backlog.blockers_to_add(40, [36, 38], [36])

        self.assertEqual(todo, [38])

    def test_should_refuse_when_the_issue_blocks_itself(self):
        with self.assertRaises(backlog.Fail) as ctx:
            backlog.blockers_to_add(40, [36, 40], [])

        self.assertEqual(ctx.exception.code, 2)

    def test_should_refuse_when_no_blocker_is_given(self):
        with self.assertRaises(backlog.Fail) as ctx:
            backlog.blockers_to_add(40, [], [])

        self.assertEqual(ctx.exception.code, 2)


class TriageCommentTest(unittest.TestCase):
    def test_should_list_every_card_when_there_are_several(self):
        comment = backlog.triage_comment([35, 36])

        self.assertIn("backlog cards:", comment)
        self.assertIn("- #35\n- #36", comment)

    def test_should_say_card_when_there_is_one(self):
        comment = backlog.triage_comment([35])

        self.assertIn("backlog card:", comment)


if __name__ == "__main__":
    unittest.main()
