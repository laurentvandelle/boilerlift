#!/usr/bin/env python3
"""Resolves the Template branch to one SHA and checks it out as a fresh project (step `template` of
verify.yml and release.yml).

The Template branch is the boilerlift-template branch a boilerlift pull request or release is checked
against. For a pull request: the branch with the pull request's head branch name when it exists, else
`main`; a pull request from a fork always uses `main`. For a release: the `template_branch` input of
release.yml, `main` when it does not exist. The SHA must fast-forward boilerlift-template `main`, or the
step fails. The template repository is public, so reading it needs no token.

Environment: MODE (`pull_request` or `release`), REPOSITORY, HEAD_REF and HEAD_REPO (pull request),
TEMPLATE_BRANCH, VERSION and TEMPLATE_NEEDED (release), RUNNER_TEMP, GITHUB_OUTPUT.
Step outputs: `branch`, `sha`, `action` (release: `update`, `tag` or `none`) and `dir`, the fresh project.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

TEMPLATE_REPOSITORY = "laurentvandelle/boilerlift-template"
TEMPLATE_URL = f"https://github.com/{TEMPLATE_REPOSITORY}.git"
MAIN = "main"

# `git ls-remote --exit-code` exits 2 when no ref matches.
NO_MATCHING_REF = 2


def pull_request_branch(head_ref: str, head_repo: str, repository: str) -> str:
    """The Template branch to try for a pull request: its head branch name, or `main` for a fork or a push."""
    if not head_ref or head_repo != repository:
        return MAIN
    return head_ref


def head_sha(returncode: int, stdout: str, ref: str) -> str | None:
    """The SHA `git ls-remote --exit-code` printed for one ref, None when the ref does not exist."""
    if returncode == NO_MATCHING_REF:
        return None
    if returncode != 0:
        raise RuntimeError(f"git ls-remote failed for {ref} (exit {returncode})")
    return stdout.split()[0]


def boilerlift_spec(package_json: str) -> str | None:
    """The version range of boilerlift in a package.json, from devDependencies or dependencies."""
    package = json.loads(package_json)
    for field in ("devDependencies", "dependencies"):
        spec = package.get(field, {}).get("boilerlift")
        if spec:
            return spec
    return None


def release_action(tag_exists: bool, main_package_json: str, version: str) -> str:
    """What the release does in boilerlift-template: `none` when the tag exists, `tag` when `main`
    already depends on this version, else `update` (fast-forward, commit the version, tag)."""
    if tag_exists:
        return "none"
    if boilerlift_spec(main_package_json) == f"^{version}":
        return "tag"
    return "update"


def not_fast_forward(branch: str) -> str:
    """The failure message when the Template branch cannot fast-forward `main`."""
    return (
        f"The Template branch {branch} of {TEMPLATE_REPOSITORY} cannot be fast-forwarded from {MAIN}: "
        f"rebase {branch} on {MAIN}, push it, then run this check again."
    )


def ls_remote_head(url: str, branch: str) -> str | None:
    ref = f"refs/heads/{branch}"
    result = subprocess.run(["git", "ls-remote", "--exit-code", url, ref], capture_output=True, text=True)
    return head_sha(result.returncode, result.stdout, ref)


def git(directory: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(directory), *args], check=True, capture_output=True, text=True).stdout


def is_ancestor(directory: Path, ancestor: str, descendant: str) -> bool:
    command = ["git", "-C", str(directory), "merge-base", "--is-ancestor", ancestor, descendant]
    return subprocess.run(command, capture_output=True).returncode == 0


def resolve(branch: str) -> tuple[str, str]:
    """The branch that exists (falling back to `main`) and its SHA."""
    sha = ls_remote_head(TEMPLATE_URL, branch)
    if sha is None and branch != MAIN:
        print(f"{TEMPLATE_REPOSITORY} has no branch {branch}: using {MAIN}.")
        branch, sha = MAIN, ls_remote_head(TEMPLATE_URL, MAIN)
    if sha is None:
        raise RuntimeError(f"{TEMPLATE_REPOSITORY} has no branch {MAIN}")
    return branch, sha


def main() -> int:
    mode = os.environ["MODE"]
    if mode == "pull_request":
        wanted = pull_request_branch(os.environ.get("HEAD_REF", ""), os.environ.get("HEAD_REPO", ""), os.environ["REPOSITORY"])
    else:
        wanted = os.environ.get("TEMPLATE_BRANCH") or MAIN

    branch, sha = resolve(wanted)
    directory = Path(os.environ["RUNNER_TEMP"]) / "boilerlift-template"
    shutil.rmtree(directory, ignore_errors=True)
    subprocess.run(["git", "clone", "--quiet", "--no-checkout", TEMPLATE_URL, str(directory)], check=True)
    main_sha = git(directory, "rev-parse", f"origin/{MAIN}").strip()

    action = ""
    if mode == "release":
        needed = os.environ.get("TEMPLATE_NEEDED") == "true"
        main_package = git(directory, "show", f"origin/{MAIN}:package.json")
        action = release_action(not needed, main_package, os.environ["VERSION"])
        if action != "update":
            # The template of this version is already on main: check main as it is.
            print(f"{TEMPLATE_REPOSITORY} {MAIN} already holds this version ({action}): checking {MAIN}.")
            branch, sha = MAIN, main_sha

    if not is_ancestor(directory, main_sha, sha):
        print(f"::error::{not_fast_forward(branch)}")
        return 1

    git(directory, "checkout", "--quiet", "--detach", sha)
    # A fresh project, as "Use this template" gives it: the files, no history.
    shutil.rmtree(directory / ".git")
    print(f"Template branch: {branch} at {sha}.")

    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for key, value in {"branch": branch, "sha": sha, "action": action, "dir": str(directory)}.items():
            output.write(f"{key}={value}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
