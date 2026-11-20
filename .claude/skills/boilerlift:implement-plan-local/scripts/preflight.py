#!/usr/bin/env python3
"""Check a pull request is ready to implement here, and pick the install and verify commands.

Reads the pull request with gh, checks it is OPEN and that the current branch is
its head branch, then detects the dependency install command (from the lockfile)
and the verify command (package.json "verify" script). Changes nothing.

stdout: one JSON object
  ok, pr {number, title, url, head, state, body}, branch, spec_url,
  install (command or null), verify (command or null), problems [..]
exit 0  ready (problems is empty)
exit 1  not ready: problems names each reason
exit 2  usage error, gh/git missing, or gh pr view failed
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)


def install_command(root: Path):
    """The lockfile's manager, in a mode that cannot rewrite the lockfile."""
    if not (root / "package.json").is_file() or (root / "node_modules").exists():
        return None
    if (root / "pnpm-lock.yaml").is_file():
        return "pnpm install --frozen-lockfile"
    if (root / "yarn.lock").is_file():
        return "yarn install --immutable"
    if (root / "package-lock.json").is_file():
        return "npm ci"
    return "npm install"


def verify_command(root: Path):
    try:
        scripts = json.loads((root / "package.json").read_text(encoding="utf-8")).get("scripts") or {}
    except (OSError, ValueError):
        return None
    return "npm run verify" if str(scripts.get("verify") or "").strip() else None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Read a pull request, check it is open and checked out here, and detect the "
                    "install and verify commands. Changes nothing.",
        epilog="exit 0 ready; exit 1 not ready (see problems); exit 2 usage or gh error.\n"
               "example: preflight.py https://github.com/acme/app/pull/12",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("pr_url", help="GitHub pull request URL")
    args = parser.parse_args(argv)
    for tool in ("git", "gh"):
        if not shutil.which(tool):
            print(f"error: {tool} is required", file=sys.stderr)
            return 2

    view = run(["gh", "pr", "view", args.pr_url, "--json", "title,number,body,url,headRefName,state"])
    if view.returncode != 0:
        msg = (view.stderr.strip().splitlines() or ["gh pr view failed"])[0]
        print(f"error: gh pr view failed: {msg}", file=sys.stderr)
        return 2
    pr = json.loads(view.stdout)
    top = run(["git", "rev-parse", "--show-toplevel"])
    if top.returncode != 0:
        print("error: not inside a git checkout", file=sys.stderr)
        return 2
    root = Path(top.stdout.strip())
    branch = run(["git", "branch", "--show-current"]).stdout.strip()

    problems = []
    if pr.get("state") != "OPEN":
        problems.append(f"pull request is {pr.get('state')}, not OPEN: pushing there goes nowhere useful")
    if branch != pr.get("headRefName"):
        problems.append(f"current branch {branch or '(detached)'} is not the head branch {pr.get('headRefName')}")
    body = pr.get("body") or ""
    spec = next((line.split(":", 1)[1].strip() for line in body.splitlines() if line.startswith("Spec:")), None)

    result = {
        "ok": not problems,
        "pr": {"number": pr.get("number"), "title": pr.get("title"), "url": pr.get("url"),
               "head": pr.get("headRefName"), "state": pr.get("state"), "body": body},
        "branch": branch,
        "spec_url": spec,
        "install": install_command(root),
        "verify": verify_command(root),
        "problems": problems,
    }
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
