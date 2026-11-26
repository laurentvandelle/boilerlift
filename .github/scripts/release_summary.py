#!/usr/bin/env python3
"""Writes the job summary of release.yml (step `summary`, which always runs).

Each of npm, tag, GitHub release and template (the boilerlift-template commit and tag) is `published`, `skipped (already done)` or `not done`.
Reads the outputs of the `check` step and the outcomes of the publish steps from the environment.
"""

import os
import sys
from collections.abc import Mapping

STEPS = (("npm", "NPM"), ("tag", "TAG"), ("GitHub release", "RELEASE"), ("boilerlift-template", "TEMPLATE"))


def status(env: Mapping[str, str], step: str) -> str:
    """The status of one step (`NPM`, `TAG`, `RELEASE` or `TEMPLATE`)."""
    if env.get("CHECK_OUTCOME") != "success":
        return "not done"
    if env.get("WORK") != "true":
        return "skipped (already done)" if env.get("REASON", "").endswith("fully released") else "not done"
    if env.get(f"{step}_NEEDED") != "true":
        return "skipped (already done)"
    return "published" if env.get(f"{step}_OUTCOME") == "success" else "not done"


def render(env: Mapping[str, str]) -> str:
    """The Markdown job summary."""
    lines = [f"## Release {env.get('TAG') or '(version unknown)'}", ""]
    if env.get("REASON"):
        lines += [f"{env['REASON']}.", ""]
    lines += ["| Step | Status |", "| --- | --- |"]
    lines += [f"| {label} | {status(env, step)} |" for label, step in STEPS]
    return "\n".join(lines) + "\n"


def main() -> int:
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(render(os.environ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
