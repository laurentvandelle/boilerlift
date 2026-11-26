"""Tests of the boilerlift-template scripts. Run with `python3 -m unittest discover -s .github/scripts`."""

import json
import unittest

from template_branch import boilerlift_spec, head_sha, not_fast_forward, pull_request_branch, release_action
from template_release import bot_identity, with_boilerlift_version

REPOSITORY = "laurentvandelle/boilerlift"
SHA = "440fb8ceb17b32c8bdc292d28f4cc03978b7768b"
PACKAGE = """{
  "private": true,
  "scripts": {
    "verify": "npm run lint"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "boilerlift": "^0.2.0",
    "vitest": "^4.1.12"
  }
}
"""


class PullRequestBranchTest(unittest.TestCase):
    def test_should_use_the_head_branch_name_when_the_pull_request_comes_from_this_repository(self):
        branch = pull_request_branch("tech/90-template", REPOSITORY, REPOSITORY)

        self.assertEqual(branch, "tech/90-template")

    def test_should_use_main_when_the_pull_request_comes_from_a_fork(self):
        branch = pull_request_branch("tech/90-template", "someone/boilerlift", REPOSITORY)

        self.assertEqual(branch, "main")

    def test_should_use_main_when_the_run_is_a_push(self):
        branch = pull_request_branch("", "", REPOSITORY)

        self.assertEqual(branch, "main")


class HeadShaTest(unittest.TestCase):
    def test_should_return_the_sha_when_the_ref_exists(self):
        sha = head_sha(0, f"{SHA}\trefs/heads/main\n", "refs/heads/main")

        self.assertEqual(sha, SHA)

    def test_should_return_none_when_no_ref_matches(self):
        sha = head_sha(2, "", "refs/heads/tech/90-template")

        self.assertIsNone(sha)

    def test_should_fail_when_git_fails_for_another_reason(self):
        with self.assertRaises(RuntimeError):
            head_sha(128, "", "refs/heads/main")


class ReleaseActionTest(unittest.TestCase):
    def test_should_do_nothing_when_the_template_tag_exists(self):
        action = release_action(True, PACKAGE, "0.3.0")

        self.assertEqual(action, "none")

    def test_should_only_tag_when_main_already_depends_on_the_version(self):
        action = release_action(False, PACKAGE, "0.2.0")

        self.assertEqual(action, "tag")

    def test_should_update_main_when_it_depends_on_an_older_version(self):
        action = release_action(False, PACKAGE, "0.3.0")

        self.assertEqual(action, "update")


class BoilerliftSpecTest(unittest.TestCase):
    def test_should_read_the_range_from_dependencies_when_devdependencies_do_not_list_it(self):
        spec = boilerlift_spec('{"dependencies": {"boilerlift": "^1.0.0"}}')

        self.assertEqual(spec, "^1.0.0")

    def test_should_return_none_when_boilerlift_is_not_a_dependency(self):
        spec = boilerlift_spec('{"private": true}')

        self.assertIsNone(spec)


class WithBoilerliftVersionTest(unittest.TestCase):
    def test_should_change_only_the_boilerlift_range_when_it_is_a_dev_dependency(self):
        text = with_boilerlift_version(PACKAGE, "0.3.0")

        self.assertEqual(text, PACKAGE.replace('"boilerlift": "^0.2.0"', '"boilerlift": "^0.3.0"'))

    def test_should_add_it_to_devdependencies_when_boilerlift_is_not_listed(self):
        text = with_boilerlift_version('{"private": true}', "0.3.0")

        self.assertEqual(json.loads(text)["devDependencies"], {"boilerlift": "^0.3.0"})


class BotIdentityTest(unittest.TestCase):
    def test_should_use_the_noreply_address_of_the_bot_user_when_given_the_app_slug(self):
        identity = bot_identity("boilerlift-release", "123")

        self.assertEqual(identity, ("boilerlift-release[bot]", "123+boilerlift-release[bot]@users.noreply.github.com"))


class NotFastForwardTest(unittest.TestCase):
    def test_should_say_to_rebase_the_branch_on_main_when_it_cannot_fast_forward(self):
        message = not_fast_forward("tech/90-template")

        self.assertIn("rebase tech/90-template on main", message)


if __name__ == "__main__":
    unittest.main()
