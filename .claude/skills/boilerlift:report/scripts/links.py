#!/usr/bin/env python3
"""Print a link to one line of a pull request diff, pinned to a commit.

The link opens the "Files changed" tab of the pull request at that commit, on the
named line, so later pushes do not shift it:

  https://github.com/<owner>/<repo>/pull/<n>/files/<sha>#diff-<sha256 hex of path><R|L><line>

R is a line on the new side (added or kept), L a line on the old side (deleted).
Changes nothing and calls no network.

stdout: the URL
stderr: a single "error:" line on failure
exit 0  printed
exit 2  usage error: bad pull request URL, SHA, path, line or side
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys

PR_URL = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/pull/(\d+)/?$")
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


class UsageError(Exception):
    pass


def diff_link(pr_url: str, sha: str, path: str, line: int, side: str) -> str:
    match = PR_URL.match(pr_url.strip())
    if not match:
        raise UsageError(f"not a GitHub pull request URL: {pr_url}")
    owner, repo, number = match.groups()
    sha = sha.strip().lower()
    if not FULL_SHA.match(sha):
        raise UsageError(f"not a full 40-character commit SHA: {sha}")
    path = path.strip()
    if not path or path.startswith("/") or path.startswith("./"):
        raise UsageError(f"path must be relative to the repository root: {path!r}")
    if line < 1:
        raise UsageError(f"line must be 1 or more: {line}")
    if side not in ("R", "L"):
        raise UsageError(f"side must be R (new line) or L (deleted line): {side}")
    anchor = hashlib.sha256(path.encode("utf-8")).hexdigest()
    return f"https://github.com/{owner}/{repo}/pull/{number}/files/{sha}#diff-{anchor}{side}{line}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pr", required=True, help="pull request URL")
    parser.add_argument("--sha", required=True, help="full SHA of the pushed head commit")
    parser.add_argument("--path", required=True, help="file path, relative to the repository root")
    parser.add_argument("--line", required=True, type=int, help="line number on the chosen side")
    parser.add_argument("--side", default="R", help="R for a new or kept line (default), L for a deleted line")
    args = parser.parse_args(argv)
    try:
        print(diff_link(args.pr, args.sha, args.path, args.line, args.side))
    except UsageError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
