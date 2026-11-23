#!/usr/bin/env python3
"""Closes the parent of a closed issue once all its sub-issues are closed (step `close` of close-parent.yml).

A parent is an issue triaged by /boilerlift:create-backlog-card: its cards are its sub-issues. It closes
as `completed` when at least one card was completed, else as `not planned`, with a comment listing the
cards. It never reopens anything. Reads ISSUE_NUMBER and GITHUB_REPOSITORY; gh uses GH_TOKEN.
"""

import json
import os
import subprocess
import sys
from collections.abc import Sequence

QUERY = """
query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){issue(number:$num){
 parent{number state subIssues(first:100){totalCount nodes{number state stateReason}}}}}}
"""


def decide(parent_state: str, total: int, subs: Sequence[dict]) -> str | None:
    """The close reason for the parent (`completed` or `not planned`), or None to leave it open."""
    if parent_state != "OPEN" or not subs or total > len(subs):
        return None
    if any(s["state"] != "CLOSED" for s in subs):
        return None
    return "completed" if any(s.get("stateReason") == "COMPLETED" for s in subs) else "not planned"


def comment(reason: str, subs: Sequence[dict]) -> str:
    """The closing comment on the parent."""
    cards = ", ".join(f"#{s['number']}" for s in subs)
    if reason == "completed":
        return f"Every card of this issue is closed ({cards}), so this issue is done."
    return f"Every card of this issue was closed without being done ({cards}), so this issue is closed as not planned."


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def main() -> int:
    owner, name = os.environ["GITHUB_REPOSITORY"].split("/")
    num = os.environ["ISSUE_NUMBER"]
    data = json.loads(gh("api", "graphql", "-f", f"query={QUERY}", "-f", f"owner={owner}", "-f", f"name={name}", "-F", f"num={num}"))
    parent = data["data"]["repository"]["issue"]["parent"]
    if not parent:
        print(f"#{num} has no parent: nothing to do")
        return 0
    subs = parent["subIssues"]["nodes"]
    reason = decide(parent["state"], parent["subIssues"]["totalCount"], subs)
    if reason is None:
        print(f"parent #{parent['number']} stays as it is")
        return 0
    gh("issue", "close", str(parent["number"]), "--repo", f"{owner}/{name}", "--reason", reason, "--comment", comment(reason, subs))
    print(f"closed parent #{parent['number']} as {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
