#!/usr/bin/env python3
"""Releases the Project template in boilerlift-template (step `template_release` of release.yml, after
`npm publish`, the boilerlift tag and the GitHub release).

Checks before it acts, in this order: the tag vX.Y.Z exists in boilerlift-template, nothing to do;
`main`'s package.json already depends on `^X.Y.Z`, only tag `main`; otherwise fast-forward `main` to
the SHA the pre-publish check ran on, set `"boilerlift": "^X.Y.Z"`, commit `chore(release): vX.Y.Z`
and tag it, in one atomic push. Then deletes the Template branch, unless it is `main`.

Pushes with a short-lived token of the GitHub App installed on boilerlift-template.
Environment: TOKEN, APP_SLUG, VERSION, SHA (the checked SHA), BRANCH (the Template branch),
RUNNER_TEMP, GITHUB_OUTPUT. Step output: `result` (`skipped`, `tagged` or `updated`).
"""

import base64
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from template_branch import MAIN, TEMPLATE_REPOSITORY, TEMPLATE_URL, head_sha, ls_remote_head, release_action


def with_boilerlift_version(package_json: str, version: str) -> str:
    """The package.json text with `"boilerlift": "^version"`, where boilerlift is listed (else in
    devDependencies), keeping the key order and the 2-space indent."""
    package = json.loads(package_json)
    field = "dependencies" if "boilerlift" in package.get("dependencies", {}) else "devDependencies"
    package.setdefault(field, {})["boilerlift"] = f"^{version}"
    return json.dumps(package, indent=2, ensure_ascii=False) + "\n"


def bot_identity(slug: str, user_id: str) -> tuple[str, str]:
    """The git author name and email of a GitHub App's bot user."""
    name = f"{slug}[bot]"
    return name, f"{user_id}+{name}@users.noreply.github.com"


def tag_exists(tag: str) -> bool:
    ref = f"refs/tags/{tag}"
    result = subprocess.run(["git", "ls-remote", "--exit-code", "--tags", TEMPLATE_URL, ref], capture_output=True, text=True)
    return head_sha(result.returncode, result.stdout, ref) is not None


def auth_env(token: str) -> dict[str, str]:
    """The environment that makes git send the token as a header, as actions/checkout does: the token
    stays out of every command line and remote URL, so no error message can print it."""
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return {
        **os.environ,
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
        "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {basic}",
    }


ENV: dict[str, str] = dict(os.environ)


def run(directory: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(directory), *args], check=True, capture_output=True, text=True, env=ENV).stdout


def write_result(result: str) -> None:
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"result={result}\n")


def main() -> int:
    version, sha, branch = os.environ["VERSION"], os.environ["SHA"], os.environ["BRANCH"]
    tag = f"v{version}"

    if tag_exists(tag):
        print(f"{TEMPLATE_REPOSITORY} already has {tag}: nothing to do.")
        write_result("skipped")
        return 0

    directory = Path(os.environ["RUNNER_TEMP"]) / "boilerlift-template-release"
    shutil.rmtree(directory, ignore_errors=True)
    ENV.update(auth_env(os.environ["TOKEN"]))
    subprocess.run(["git", "clone", "--quiet", TEMPLATE_URL, str(directory)], check=True, env=ENV)

    action = release_action(False, run(directory, "show", f"origin/{MAIN}:package.json"), version)
    if action == "tag":
        run(directory, "tag", tag, f"origin/{MAIN}")
        run(directory, "push", "origin", f"refs/tags/{tag}")
        print(f"{TEMPLATE_REPOSITORY} {MAIN} already depends on ^{version}: tagged {tag}.")
        result = "tagged"
    else:
        if subprocess.run(["git", "-C", str(directory), "merge-base", "--is-ancestor", f"origin/{MAIN}", sha], env=ENV).returncode != 0:
            print(f"::error::{TEMPLATE_REPOSITORY} {MAIN} moved since the check and {sha} no longer fast-forwards it: dispatch the release again.")
            return 1
        run(directory, "checkout", "--quiet", "--detach", sha)
        package = directory / "package.json"
        package.write_text(with_boilerlift_version(package.read_text(), version))
        slug = os.environ["APP_SLUG"]
        user_id = subprocess.run(["gh", "api", f"users/{slug}[bot]", "--jq", ".id"], check=True, capture_output=True, text=True).stdout.strip()
        name, email = bot_identity(slug, user_id)
        run(directory, "-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "--quiet", "-am", f"chore(release): {tag}")
        run(directory, "tag", tag)
        # Not forced: the remote refuses anything but a fast-forward of main.
        run(directory, "push", "--atomic", "origin", f"HEAD:refs/heads/{MAIN}", f"refs/tags/{tag}")
        print(f"{TEMPLATE_REPOSITORY} {MAIN} fast-forwarded to {sha}, set to ^{version} and tagged {tag}.")
        result = "updated"

    if branch != MAIN and ls_remote_head(TEMPLATE_URL, branch) is not None:
        run(directory, "push", "origin", "--delete", f"refs/heads/{branch}")
        print(f"Deleted the Template branch {branch}.")

    write_result(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
