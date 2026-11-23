#!/usr/bin/env python3
"""Read and write boilerlift backlog cards: issues in the repo, items in GitHub project 3.

Subcommands:
  context                          check gh auth, print the project's Card type and Status options
  read   --issue N                 print an issue and its Type/Status in the project
  create --type T --title X --body-file F [--dry-run]
                                   create the issue, add it to the project, Card type=T, Status=Backlog
  update --issue N --type T --title X --body-file F [--dry-run]
                                   rewrite the issue in place, add it to the project if missing,
                                   Card type=T, Status=Backlog only when Status is empty or Inbox,
                                   removes the "inbox" label if the issue has it
  setup-type-field [--dry-run]     create the single-select field "Card type" (run only after the user agrees)

Examples:
  backlog.py context
  backlog.py create --type story --title "Add lift diff command" --body-file /tmp/card1.md

stdout: one JSON object.  stderr: a single "error:" line on failure.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

OWNER = "laurentvandelle"
PROJECT = 3
REPO = "laurentvandelle/boilerlift"
TYPES = ["story", "tech story", "bug", "investigation"]
BACKLOG = "Backlog"
# GitHub reserves the field name "Type" (issue types), so the project field is "Card type"
TYPE_FIELD = "Card type"
INBOX = "inbox"  # label set by /boilerlift:inbox on raw ideas

EXIT_CODES = """\
exit 0  success (or a dry-run)
exit 2  usage error, or gh missing
exit 3  gh not authenticated, or token lacks the project scope
exit 4  not found: issue, project, Card type field, a Card type option or the Backlog status option
exit 5  an open issue already has this title (create only)
exit 6  a gh call failed (a create that fails after the issue exists names its URL)"""


class Fail(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def gh(*args: str, parse: bool = True):
    proc = subprocess.run(["gh", *args], capture_output=True, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout).strip().removeprefix("error: ").replace("\n", " ")
        if "auth login" in err or "not logged" in err.lower():
            raise Fail(3, f"{err} -- run: gh auth login, then gh auth refresh -s project")
        if "missing required scopes" in err or "required scopes" in err:
            raise Fail(3, "gh token lacks the project scope -- run: gh auth refresh -s project")
        if "Could not resolve to an Issue" in err:
            raise Fail(4, f"issue not found in {REPO}")
        raise Fail(6, f"gh {' '.join(args[:3])} failed: {err}")
    return json.loads(proc.stdout) if parse and proc.stdout.strip() else proc.stdout


def project() -> dict:
    view = gh("project", "view", str(PROJECT), "--owner", OWNER, "--format", "json")
    fields = gh("project", "field-list", str(PROJECT), "--owner", OWNER, "--format", "json", "--limit", "50")
    by_name = {f["name"]: f for f in fields.get("fields", [])}

    def options(name: str):
        f = by_name.get(name)
        if not f:
            return None
        # match option names case-insensitively, so "Story" set by hand in the UI still works
        return {"id": f["id"], "options": {o["name"].lower(): o["id"] for o in f.get("options", [])}}

    return {"id": view["id"], "url": view.get("url"), "title": view.get("title"),
            "type": options(TYPE_FIELD), "status": options("Status")}


def check(p: dict, card_type: str | None = None) -> None:
    if p["type"] is None:
        raise Fail(4, f'project has no "{TYPE_FIELD}" field -- ask the user, then run setup-type-field')
    missing = [t for t in TYPES if t not in p["type"]["options"]]
    if p["status"] is None or BACKLOG.lower() not in p["status"]["options"]:
        avail = sorted(p["status"]["options"]) if p["status"] else []
        raise Fail(4, f'Status option "{BACKLOG}" missing; available: {avail} -- the user adds it in the project settings')
    if missing:
        raise Fail(4, f'Type options missing: {missing} -- the user adds them in the project settings')


ITEM_QUERY = """
query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){issue(number:$num){
 number title body url state labels(first:30){nodes{name}}
 projectItems(first:20){nodes{id project{number owner{... on User{login}}}
  fieldValues(first:30){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}}}}}}}
"""


def read_issue(num: int) -> dict:
    owner, name = REPO.split("/")
    data = gh("api", "graphql", "-f", f"query={ITEM_QUERY}", "-f", f"owner={owner}", "-f", f"name={name}", "-F", f"num={num}")
    issue = ((data.get("data") or {}).get("repository") or {}).get("issue")
    if not issue:
        raise Fail(4, f"issue #{num} not found in {REPO}")
    item = None
    for node in issue["projectItems"]["nodes"]:
        if node["project"]["number"] == PROJECT and (node["project"]["owner"] or {}).get("login") == OWNER:
            values = {v["field"]["name"]: v["name"] for v in node["fieldValues"]["nodes"] if v.get("field")}
            item = {"id": node["id"], "type": values.get(TYPE_FIELD), "status": values.get("Status")}
    return {"number": issue["number"], "title": issue["title"], "body": issue["body"], "url": issue["url"],
            "state": issue["state"], "labels": [l["name"] for l in issue["labels"]["nodes"]], "project_item": item}


def set_field(p: dict, item_id: str, field: dict, option: str) -> None:
    gh("project", "item-edit", "--id", item_id, "--project-id", p["id"], "--field-id", field["id"],
       "--single-select-option-id", field["options"][option.lower()], parse=False)


def add_to_project(url: str) -> str:
    # item-add returns the existing item when the issue is already in the project
    return gh("project", "item-add", str(PROJECT), "--owner", OWNER, "--url", url, "--format", "json")["id"]


def body_of(path: str) -> str:
    f = Path(path)
    if not f.is_file() or not f.read_text().strip():
        raise Fail(2, f"--body-file {path} is missing or empty")
    return f.read_text()


def cmd_context(_a) -> dict:
    p = project()
    check(p)
    return {"repo": REPO, "project": {"url": p["url"], "title": p["title"]},
            "types": sorted(p["type"]["options"]), "statuses": sorted(p["status"]["options"])}


def cmd_read(a) -> dict:
    return read_issue(a.issue)


def cmd_create(a) -> dict:
    body = body_of(a.body_file)
    p = project()
    check(p, a.type)
    dupes = gh("issue", "list", "--repo", REPO, "--state", "open", "--search", f'"{a.title}" in:title',
               "--json", "number,title,url")
    same = [d for d in dupes if d["title"].strip().lower() == a.title.strip().lower()]
    if same:
        raise Fail(5, f"open issue already titled this way: {same[0]['url']}")
    if a.dry_run:
        return {"dry_run": True, "would_create": {"title": a.title, "type": a.type, "status": BACKLOG, "body_chars": len(body)}}
    url = gh("issue", "create", "--repo", REPO, "--title", a.title, "--body-file", a.body_file, parse=False).strip().splitlines()[-1]
    try:
        item = add_to_project(url)
        set_field(p, item, p["type"], a.type)
        set_field(p, item, p["status"], BACKLOG)
    except Fail as e:
        # the issue exists: finish it with update, not a second create (which would hit exit 5)
        raise Fail(e.code, f"issue created at {url} but project fields failed ({e}) -- rerun with: update --issue {url.rsplit('/', 1)[-1]}")
    return {"created": url, "type": a.type, "status": BACKLOG}


def cmd_update(a) -> dict:
    body_of(a.body_file)
    p = project()
    check(p, a.type)
    issue = read_issue(a.issue)
    status = (issue["project_item"] or {}).get("status")
    if status and status.lower() == INBOX:
        status = None  # an idea parked in the board's Inbox column becomes a Backlog card
    # an idea captured by /boilerlift:inbox stops being "inbox" once it is a card
    drop_inbox = INBOX in issue["labels"]
    if a.dry_run:
        return {"dry_run": True, "would_update": issue["url"], "title": a.title, "type": a.type,
                "status": status or BACKLOG, "removes_label": INBOX if drop_inbox else None}
    edit = ["issue", "edit", str(a.issue), "--repo", REPO, "--title", a.title, "--body-file", a.body_file]
    gh(*edit, *(["--remove-label", INBOX] if drop_inbox else []), parse=False)
    item = add_to_project(issue["url"])
    set_field(p, item, p["type"], a.type)
    if not status:
        set_field(p, item, p["status"], BACKLOG)
        status = BACKLOG
    return {"updated": issue["url"], "type": a.type, "status": status}


def cmd_setup(a) -> dict:
    p = project()
    if p["type"] is not None:
        return {"exists": True, "options": sorted(p["type"]["options"])}
    if a.dry_run:
        return {"dry_run": True, "would_create_field": TYPE_FIELD, "options": TYPES}
    gh("project", "field-create", str(PROJECT), "--owner", OWNER, "--name", TYPE_FIELD,
       "--data-type", "SINGLE_SELECT", "--single-select-options", ",".join(TYPES), parse=False)
    return {"created_field": TYPE_FIELD, "options": TYPES}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, epilog=EXIT_CODES, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("context").set_defaults(fn=cmd_context)
    r = sub.add_parser("read"); r.add_argument("--issue", type=int, required=True); r.set_defaults(fn=cmd_read)
    for name, fn in (("create", cmd_create), ("update", cmd_update)):
        s = sub.add_parser(name)
        if name == "update":
            s.add_argument("--issue", type=int, required=True)
        s.add_argument("--type", required=True, choices=TYPES)
        s.add_argument("--title", required=True)
        s.add_argument("--body-file", required=True)
        s.add_argument("--dry-run", action="store_true")
        s.set_defaults(fn=fn)
    st = sub.add_parser("setup-type-field"); st.add_argument("--dry-run", action="store_true"); st.set_defaults(fn=cmd_setup)
    a = ap.parse_args()
    if not shutil.which("gh"):
        print("error: gh CLI not found -- install it from https://cli.github.com", file=sys.stderr)
        return 2
    try:
        print(json.dumps(a.fn(a), indent=2))
        return 0
    except Fail as e:
        print(f"error: {e}", file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main())
