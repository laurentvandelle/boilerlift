#!/usr/bin/env python3
"""Read and write boilerlift backlog cards: issues in the repo, items in GitHub project 3.

Subcommands:
  context                          check gh auth, print the project's Card type and Status options
  read   --issue N                 print an issue and its Type/Status in the project
  create --type T --title X --body-file F [--parent N] [--dry-run]
                                   create the issue, add it to the project, Card type=T, Status=Ready;
                                   with --parent, attach it as a sub-issue of issue N
  update --issue N --type T --title X --body-file F [--dry-run]
                                   rewrite an existing card in place, add it to the project if missing,
                                   Card type=T, Status=Ready only when Status is empty or Backlog
  link   --parent N --issue M [--dry-run]
                                   attach issue M as a sub-issue of issue N (finishes a create that failed there)
  triage --issue N --cards 35,36 [--dry-run]
                                   comment the cards on parent issue N, then archive its board item
  close  --issue N --reason "not planned"|duplicate [--duplicate-of M] --comment-file F [--dry-run]
                                   close an issue that gets no card, with a one-line reason
  status --issue N --status S [--only-from A,B] [--dry-run]
                                   set the card's Status; skipped when the current Status is not in --only-from
  setup-type-field [--dry-run]     create the single-select field "Card type" (run only after the user agrees)

--issue, --parent, --cards and --duplicate-of take a number, #N, or an issue URL of the repository.

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
import re
import sys
import time
from pathlib import Path

OWNER = "laurentvandelle"
PROJECT = 3
REPO = "laurentvandelle/boilerlift"
TYPES = ["story", "tech story", "bug", "investigation"]
READY = "Ready"  # a created card has passed the Definition of Ready
BACKLOG = "Backlog"
# GitHub reserves the field name "Type" (issue types), so the project field is "Card type"
TYPE_FIELD = "Card type"
CLOSE_REASONS = ["not planned", "duplicate"]
# the board's "Item added to project" rule sets Backlog asynchronously, so a fresh card is checked again
SETTLE_TRIES, SETTLE_DELAY = 3, 3.0

EXIT_CODES = """\
exit 0  success (or a dry-run)
exit 2  usage error, or gh missing
exit 3  gh not authenticated, or token lacks the project scope
exit 4  not found: issue, project, Card type field, a Card type option or the Ready status option
exit 5  an open issue already has this title (create only)
exit 6  a gh call failed (a create that fails after the issue exists names its URL and the command to finish it)"""


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
    if p["status"] is None or READY.lower() not in p["status"]["options"]:
        avail = sorted(p["status"]["options"]) if p["status"] else []
        raise Fail(4, f'Status option "{READY}" missing; available: {avail} -- the user adds it in the project settings')
    if missing:
        raise Fail(4, f'Type options missing: {missing} -- the user adds them in the project settings')


def issue_number(ref: str) -> int:
    """12, #12 or https://github.com/<REPO>/issues/12 -> 12."""
    ref = ref.strip()
    m = re.fullmatch(r"#?(\d+)", ref) or re.fullmatch(
        rf"https://github\.com/{re.escape(REPO)}/issues/(\d+)/?(?:[?#].*)?", ref)
    if not m:
        raise Fail(2, f"not an issue of {REPO}: {ref!r} -- pass a number, #N or its URL")
    return int(m.group(1))


def status_allowed(current: str | None, only_from: list[str]) -> bool:
    """A card with no Status yet can always be set; otherwise its Status must be listed."""
    if not only_from or not current:
        return True
    return current.lower() in {s.lower() for s in only_from}


def triage_comment(cards: list[int]) -> str:
    lines = "\n".join(f"- #{n}" for n in cards)
    noun = "card" if len(cards) == 1 else "cards"
    return (f"Triaged into backlog {noun}:\n\n{lines}\n\n"
            "This issue closes on its own once every card above is closed.")


ITEM_QUERY = """
query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){issue(number:$num){
 number databaseId title body url state stateReason author{login} labels(first:30){nodes{name}}
 parent{number url}
 closedByPullRequestsReferences(first:10,includeClosedPrs:false){nodes{url state headRefName}}
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
    prs = [{"url": n["url"], "branch": n["headRefName"]}
           for n in issue["closedByPullRequestsReferences"]["nodes"] if n["state"] == "OPEN"]
    return {"number": issue["number"], "database_id": issue["databaseId"], "title": issue["title"],
            "body": issue["body"], "url": issue["url"], "state": issue["state"],
            "author": (issue["author"] or {}).get("login"), "labels": [l["name"] for l in issue["labels"]["nodes"]],
            "parent": issue["parent"], "open_prs": prs, "project_item": item}


def set_field(p: dict, item_id: str, field: dict, option: str) -> None:
    gh("project", "item-edit", "--id", item_id, "--project-id", p["id"], "--field-id", field["id"],
       "--single-select-option-id", field["options"][option.lower()], parse=False)


def add_to_project(url: str) -> str:
    # item-add returns the existing item when the issue is already in the project
    return gh("project", "item-add", str(PROJECT), "--owner", OWNER, "--url", url, "--format", "json")["id"]


def settle_status(p: dict, num: int, wanted: str) -> None:
    for _ in range(SETTLE_TRIES):
        time.sleep(SETTLE_DELAY)
        item = read_issue(num)["project_item"]
        if item and (item["status"] or "").lower() == wanted.lower():
            return
        set_field(p, item["id"] if item else add_to_project(read_issue(num)["url"]), p["status"], wanted)


def attach(parent: int, child: int) -> None:
    child_id = read_issue(child)["database_id"]
    gh("api", "-X", "POST", f"repos/{REPO}/issues/{parent}/sub_issues", "-F", f"sub_issue_id={child_id}", parse=False)


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
    return read_issue(issue_number(a.issue))


def cmd_create(a) -> dict:
    body = body_of(a.body_file)
    p = project()
    check(p, a.type)
    parent = issue_number(a.parent) if a.parent else None
    if parent:
        read_issue(parent)  # exit 4 before anything is created
    dupes = gh("issue", "list", "--repo", REPO, "--state", "open", "--search", f'"{a.title}" in:title',
               "--json", "number,title,url")
    same = [d for d in dupes if d["title"].strip().lower() == a.title.strip().lower()]
    if same:
        raise Fail(5, f"open issue already titled this way: {same[0]['url']}")
    if a.dry_run:
        return {"dry_run": True, "would_create": {"title": a.title, "type": a.type, "status": READY,
                                                  "parent": parent, "body_chars": len(body)}}
    url = gh("issue", "create", "--repo", REPO, "--title", a.title, "--body-file", a.body_file, parse=False).strip().splitlines()[-1]
    num = int(url.rsplit("/", 1)[-1])
    try:
        item = add_to_project(url)
        set_field(p, item, p["type"], a.type)
        set_field(p, item, p["status"], READY)
        settle_status(p, num, READY)
    except Fail as e:
        # the issue exists: finish it with update, not a second create (which would hit exit 5)
        then = f" then: link --parent {parent} --issue {num}" if parent else ""
        raise Fail(e.code, f"issue created at {url} but project fields failed ({e}) -- rerun with: update --issue {num}{then}")
    if parent:
        try:
            attach(parent, num)
        except Fail as e:
            raise Fail(e.code, f"issue created at {url} but not attached to #{parent} ({e}) -- rerun with: link --parent {parent} --issue {num}")
    return {"created": url, "type": a.type, "status": READY, "parent": parent}


def cmd_update(a) -> dict:
    body_of(a.body_file)
    p = project()
    check(p, a.type)
    num = issue_number(a.issue)
    issue = read_issue(num)
    status = (issue["project_item"] or {}).get("status")
    if status and status.lower() == BACKLOG.lower():
        status = None  # a card in Backlog has now passed the Definition of Ready: it moves to Ready
    if a.dry_run:
        return {"dry_run": True, "would_update": issue["url"], "title": a.title, "type": a.type,
                "status": status or READY}
    gh("issue", "edit", str(num), "--repo", REPO, "--title", a.title, "--body-file", a.body_file, parse=False)
    item = add_to_project(issue["url"])
    set_field(p, item, p["type"], a.type)
    if not status:
        set_field(p, item, p["status"], READY)
        status = READY
    return {"updated": issue["url"], "type": a.type, "status": status}


def cmd_link(a) -> dict:
    parent, child = issue_number(a.parent), issue_number(a.issue)
    current = read_issue(child)["parent"]
    if current and current["number"] == parent:
        return {"linked": True, "already": True, "parent": parent, "issue": child}
    if a.dry_run:
        return {"dry_run": True, "would_link": {"parent": parent, "issue": child}}
    attach(parent, child)
    return {"linked": True, "parent": parent, "issue": child}


def cmd_triage(a) -> dict:
    num = issue_number(a.issue)
    cards = [issue_number(c) for c in a.cards.split(",") if c.strip()]
    if not cards:
        raise Fail(2, "--cards needs at least one issue")
    issue = read_issue(num)
    item = issue["project_item"]
    if a.dry_run:
        return {"dry_run": True, "would_comment": issue["url"], "comment": triage_comment(cards),
                "would_archive": bool(item)}
    gh("issue", "comment", str(num), "--repo", REPO, "--body", triage_comment(cards), parse=False)
    if item:
        gh("project", "item-archive", str(PROJECT), "--owner", OWNER, "--id", item["id"], parse=False)
    return {"triaged": issue["url"], "cards": cards, "archived": bool(item)}


def cmd_close(a) -> dict:
    num = issue_number(a.issue)
    comment = body_of(a.comment_file).strip()
    dup = issue_number(a.duplicate_of) if a.duplicate_of else None
    if (a.reason == "duplicate") != (dup is not None):
        raise Fail(2, "--reason duplicate goes with --duplicate-of, and only with it")
    issue = read_issue(num)
    if issue["state"] != "OPEN":
        raise Fail(4, f"issue #{num} is already closed")
    if a.dry_run:
        return {"dry_run": True, "would_close": issue["url"], "reason": a.reason, "duplicate_of": dup, "comment": comment}
    args = ["issue", "close", str(num), "--repo", REPO, "--comment", comment]
    args += ["--duplicate-of", str(dup)] if dup else ["--reason", a.reason]
    gh(*args, parse=False)
    return {"closed": issue["url"], "reason": a.reason, "duplicate_of": dup}


def cmd_status(a) -> dict:
    num = issue_number(a.issue)
    p = project()
    if p["status"] is None or a.status.lower() not in p["status"]["options"]:
        avail = sorted(p["status"]["options"]) if p["status"] else []
        raise Fail(4, f'Status option "{a.status}" missing; available: {avail}')
    issue = read_issue(num)
    current = (issue["project_item"] or {}).get("status")
    only_from = [s.strip() for s in (a.only_from or "").split(",") if s.strip()]
    if not status_allowed(current, only_from):
        return {"skipped": True, "issue": issue["url"], "status": current, "reason": f"not in {only_from}"}
    if a.dry_run:
        return {"dry_run": True, "would_set": issue["url"], "from": current, "status": a.status}
    item = (issue["project_item"] or {}).get("id") or add_to_project(issue["url"])
    set_field(p, item, p["status"], a.status)
    return {"issue": issue["url"], "from": current, "status": a.status}


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
    r = sub.add_parser("read"); r.add_argument("--issue", required=True); r.set_defaults(fn=cmd_read)
    for name, fn in (("create", cmd_create), ("update", cmd_update)):
        s = sub.add_parser(name)
        if name == "update":
            s.add_argument("--issue", required=True)
        else:
            s.add_argument("--parent")
        s.add_argument("--type", required=True, choices=TYPES)
        s.add_argument("--title", required=True)
        s.add_argument("--body-file", required=True)
        s.add_argument("--dry-run", action="store_true")
        s.set_defaults(fn=fn)
    ln = sub.add_parser("link"); ln.add_argument("--parent", required=True); ln.add_argument("--issue", required=True)
    ln.add_argument("--dry-run", action="store_true"); ln.set_defaults(fn=cmd_link)
    tr = sub.add_parser("triage"); tr.add_argument("--issue", required=True); tr.add_argument("--cards", required=True)
    tr.add_argument("--dry-run", action="store_true"); tr.set_defaults(fn=cmd_triage)
    cl = sub.add_parser("close"); cl.add_argument("--issue", required=True)
    cl.add_argument("--reason", required=True, choices=CLOSE_REASONS); cl.add_argument("--duplicate-of")
    cl.add_argument("--comment-file", required=True); cl.add_argument("--dry-run", action="store_true"); cl.set_defaults(fn=cmd_close)
    stt = sub.add_parser("status"); stt.add_argument("--issue", required=True); stt.add_argument("--status", required=True)
    stt.add_argument("--only-from"); stt.add_argument("--dry-run", action="store_true"); stt.set_defaults(fn=cmd_status)
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
