"""Tests of the release scripts. Run with `python3 -m unittest discover -s .github/scripts`."""

import unittest

from release_check import changelog_section, plan
from release_summary import render

CHANGELOG = """# Changelog

Intro.

## [0.2.0] - 2026-12-01

### Added

- New thing.

## [0.1.0] - 2026-11-20

### Fixed

- Bug.
"""

RELEASED = "v0.2.0 is already fully released"


class ChangelogSectionTest(unittest.TestCase):
    def test_should_return_the_section_without_its_heading_when_the_version_has_one(self):
        section = changelog_section(CHANGELOG, "0.2.0")

        self.assertEqual(section, "### Added\n\n- New thing.")

    def test_should_stop_at_the_end_of_the_file_when_the_section_is_the_last_one(self):
        section = changelog_section(CHANGELOG, "0.1.0")

        self.assertEqual(section, "### Fixed\n\n- Bug.")

    def test_should_return_nothing_when_only_a_longer_version_starts_the_same(self):
        section = changelog_section(CHANGELOG, "0.1")

        self.assertEqual(section, "")


class PlanTest(unittest.TestCase):
    def test_should_do_nothing_when_the_changelog_has_no_section_for_the_version(self):
        outputs = plan("0.0.1", "", npm_published=False, tag_exists=False, release_exists=False, template_tag_exists=False)

        self.assertEqual((outputs["work"], outputs["reason"]), ("false", "CHANGELOG.md has no section for 0.0.1: not a release commit"))

    def test_should_do_every_step_when_nothing_is_released_yet(self):
        outputs = plan("0.2.0", "- New thing.", npm_published=False, tag_exists=False, release_exists=False, template_tag_exists=False)

        self.assertEqual(
            (outputs["work"], outputs["npm_needed"], outputs["tag_needed"], outputs["release_needed"], outputs["template_needed"]),
            ("true", "true", "true", "true", "true"),
        )

    def test_should_do_only_the_missing_steps_when_the_release_is_partial(self):
        outputs = plan("0.2.0", "- New thing.", npm_published=True, tag_exists=False, release_exists=False, template_tag_exists=False)

        self.assertEqual((outputs["npm_needed"], outputs["tag_needed"], outputs["release_needed"]), ("false", "true", "true"))

    def test_should_do_only_the_template_when_boilerlift_is_fully_released(self):
        outputs = plan("0.2.0", "- New thing.", npm_published=True, tag_exists=True, release_exists=True, template_tag_exists=False)

        self.assertEqual(
            (outputs["work"], outputs["npm_needed"], outputs["tag_needed"], outputs["release_needed"], outputs["template_needed"]),
            ("true", "false", "false", "false", "true"),
        )

    def test_should_not_do_the_template_when_the_changelog_has_no_section_for_the_version(self):
        outputs = plan("0.0.1", "", npm_published=False, tag_exists=False, release_exists=False, template_tag_exists=False)

        self.assertEqual(outputs["template_needed"], "false")

    def test_should_do_nothing_when_the_version_is_fully_released(self):
        outputs = plan("0.2.0", "- New thing.", npm_published=True, tag_exists=True, release_exists=True, template_tag_exists=True)

        self.assertEqual((outputs["work"], outputs["reason"]), ("false", RELEASED))


class RenderTest(unittest.TestCase):
    def test_should_list_published_and_skipped_steps_when_a_partial_release_is_finished(self):
        env = {"CHECK_OUTCOME": "success", "TAG": "v0.2.0", "WORK": "true", "NPM_NEEDED": "false", "TAG_NEEDED": "true", "TAG_OUTCOME": "success", "RELEASE_NEEDED": "true", "RELEASE_OUTCOME": "success", "TEMPLATE_NEEDED": "true", "TEMPLATE_OUTCOME": "success"}

        summary = render(env)

        self.assertIn("| npm | skipped (already done) |\n| tag | published |\n| GitHub release | published |\n| boilerlift-template | published |\n", summary)

    def test_should_mark_the_steps_after_a_failure_not_done_when_a_step_fails(self):
        env = {"CHECK_OUTCOME": "success", "TAG": "v0.2.0", "WORK": "true", "NPM_NEEDED": "true", "NPM_OUTCOME": "failure", "TAG_NEEDED": "true", "TAG_OUTCOME": "skipped", "RELEASE_NEEDED": "true", "TEMPLATE_NEEDED": "true"}

        summary = render(env)

        self.assertIn("| npm | not done |\n| tag | not done |\n| GitHub release | not done |\n| boilerlift-template | not done |\n", summary)

    def test_should_mark_only_the_template_published_when_boilerlift_was_already_released(self):
        env = {"CHECK_OUTCOME": "success", "TAG": "v0.2.0", "WORK": "true", "NPM_NEEDED": "false", "TAG_NEEDED": "false", "RELEASE_NEEDED": "false", "TEMPLATE_NEEDED": "true", "TEMPLATE_OUTCOME": "success"}

        summary = render(env)

        self.assertIn("| GitHub release | skipped (already done) |\n| boilerlift-template | published |\n", summary)

    def test_should_mark_every_step_skipped_when_the_version_is_fully_released(self):
        env = {"CHECK_OUTCOME": "success", "TAG": "v0.2.0", "WORK": "false", "REASON": RELEASED}

        summary = render(env)

        self.assertEqual(summary.count("skipped (already done)"), 4)

    def test_should_mark_every_step_not_done_when_the_version_is_not_a_release(self):
        env = {"CHECK_OUTCOME": "success", "TAG": "v0.0.1", "WORK": "false", "REASON": "CHANGELOG.md has no section for 0.0.1: not a release commit"}

        summary = render(env)

        self.assertEqual(summary.count("not done"), 4)

    def test_should_mark_every_step_not_done_when_the_check_fails(self):
        env = {"CHECK_OUTCOME": "failure"}

        summary = render(env)

        self.assertTrue(summary.startswith("## Release (version unknown)\n") and summary.count("not done") == 4)


if __name__ == "__main__":
    unittest.main()
