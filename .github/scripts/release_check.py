#!/usr/bin/env python3
"""Finds what is left to release for the version in package.json (step `check` of release.yml).

A version is a release only when CHANGELOG.md has a section for it. For a release, each of the npm
version, the vX.Y.Z tag and the GitHub release is checked, so the workflow only does what is missing.
Writes the step outputs to $GITHUB_OUTPUT and the GitHub release body to $RUNNER_TEMP/release-notes.md.
"""

import json
import os
import subprocess
import sys
from pathlib import Path


def changelog_section(changelog: str, version: str) -> str:
    """The lines of the `## [version]` section of CHANGELOG.md, without its heading, or '' when there is none."""
    heading = f"## [{version}]"
    lines: list[str] = []
    found = False
    for line in changelog.splitlines():
        if not found:
            found = line.startswith(heading)
            continue
        if line.startswith("## ["):
            break
        lines.append(line)
    return "\n".join(lines).strip()


def plan(version: str, notes: str, npm_published: bool, tag_exists: bool, release_exists: bool) -> dict[str, str]:
    """The step outputs: what is left to do for this version, and why there is nothing to do when so."""
    tag = f"v{version}"
    outputs = {"version": version, "tag": tag}
    if not notes:
        return {
            **outputs,
            "work": "false",
            "npm_needed": "false",
            "tag_needed": "false",
            "release_needed": "false",
            "reason": f"CHANGELOG.md has no section for {version}: not a release commit",
        }
    needed = {"npm_needed": not npm_published, "tag_needed": not tag_exists, "release_needed": not release_exists}
    work = any(needed.values())
    return {
        **outputs,
        **{key: str(value).lower() for key, value in needed.items()},
        "work": str(work).lower(),
        "reason": "" if work else f"{tag} is already fully released",
    }


def succeeds(*command: str) -> bool:
    return subprocess.run(command, capture_output=True, text=True).returncode == 0


def npm_has(name: str, version: str) -> bool:
    """True when `npm view name@version version` prints a version. It fails when the package does not exist."""
    result = subprocess.run(["npm", "view", f"{name}@{version}", "version"], capture_output=True, text=True)
    return result.returncode == 0 and result.stdout.strip() != ""


def main() -> int:
    package = json.loads(Path("package.json").read_text())
    name, version = package["name"], package["version"]
    tag = f"v{version}"
    notes = changelog_section(Path("CHANGELOG.md").read_text(), version)

    if notes:
        outputs = plan(
            version,
            notes,
            npm_published=npm_has(name, version),
            tag_exists=succeeds("git", "ls-remote", "--exit-code", "--tags", "origin", f"refs/tags/{tag}"),
            release_exists=succeeds("gh", "release", "view", tag),
        )
    else:
        outputs = plan(version, notes, npm_published=False, tag_exists=False, release_exists=False)

    notes_file = Path(os.environ["RUNNER_TEMP"]) / "release-notes.md"
    notes_file.write_text(notes + "\n")
    outputs["notes_file"] = str(notes_file)

    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for key, value in outputs.items():
            output.write(f"{key}={value}\n")

    if outputs["reason"]:
        print(f"{outputs['reason']}: nothing to do.")
    else:
        todo = [step for step, key in (("npm", "npm_needed"), ("tag", "tag_needed"), ("GitHub release", "release_needed")) if outputs[key] == "true"]
        print(f"{tag}: left to do: {', '.join(todo)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
