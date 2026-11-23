#!/usr/bin/env python3
"""Capture a boilerlift idea as a GitHub issue.

Usage:
  inbox.py --title "Short English title" <<'EOF'
  the idea, in English
  EOF

The body is read from stdin. The issue gets no label and no field: project 3's own automations
put it in the board's Inbox column, and /boilerlift:create-backlog-card triages it later.

stdout: one JSON object {"url", "number", "title"}.  stderr: a single "error:" line on failure.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys

REPO = "laurentvandelle/boilerlift"
MAX_TITLE = 80

EXIT_CODES = """\
exit 0  issue created
exit 2  bad title or empty body: fix the title only, never the body
exit 3  gh not authenticated or token expired
exit 4  gh CLI not installed
exit 6  a gh call failed"""


class Fail(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def gh(*args: str, stdin: str | None = None) -> str:
    proc = subprocess.run(["gh", *args], input=stdin, capture_output=True, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout).strip().removeprefix("error: ").replace("\n", " ")
        if "auth login" in err or "not logged" in err.lower() or "401" in err or "Bad credentials" in err:
            raise Fail(3, f"{err} -- run: gh auth login")
        raise Fail(6, f"gh {' '.join(args[:2])} failed: {err}")
    return proc.stdout


def create(title: str, body: str) -> str:
    return gh("issue", "create", "--repo", REPO, "--title", title, "--body-file", "-", stdin=body)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, epilog=EXIT_CODES, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--title", required=True)
    a = ap.parse_args()
    title = a.title.strip()
    if sys.stdin.isatty():
        # without a heredoc, read() would wait forever
        print("error: no body -- pass the idea on stdin with a heredoc", file=sys.stderr)
        return 2
    body = sys.stdin.read().strip()
    if not title or "\n" in title or len(title) > MAX_TITLE:
        print(f"error: --title must be one line of 1 to {MAX_TITLE} characters (got {len(title)})", file=sys.stderr)
        return 2
    if not body:
        print("error: empty body -- pass the idea on stdin", file=sys.stderr)
        return 2
    if not shutil.which("gh"):
        print("error: gh CLI not found -- install it from https://cli.github.com", file=sys.stderr)
        return 4
    try:
        out = create(title, body).strip().splitlines()
    except Fail as e:
        print(f"error: {e}", file=sys.stderr)
        return e.code
    url = out[-1] if out else ""
    number = url.rsplit("/", 1)[-1]
    if "/issues/" not in url or not number.isdigit():
        print(f"error: gh issue create returned no issue URL (got {url!r}) -- check the repo issues before retrying", file=sys.stderr)
        return 6
    print(json.dumps({"url": url, "number": int(number), "title": title}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
