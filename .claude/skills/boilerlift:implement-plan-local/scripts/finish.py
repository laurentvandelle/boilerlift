#!/usr/bin/env python3
"""Squash-merge a pull request and clean up its local worktree.

Run from inside the pull request's worktree. Steps, stopping at the first failure:
  merge          gh pr merge <url> --squash, cwd = main checkout (skipped if already MERGED)
  delete_remote  gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/<branch> (already gone is ok)
  remove_worktree git -C <main> worktree remove <worktree>   (never --force)
  delete_branch  git -C <main> branch -D <branch>            (already gone is ok)
  fetch          git -C <main> fetch --prune origin
  update_base    fast-forward the local base branch in the main checkout to origin/<base>
                 (merge --ff-only when the main checkout is on it, else fetch origin <base>:<base>)

Refuses before any step when the worktree has uncommitted or untracked changes,
or commits that are on no remote branch (they would be lost by branch -D).

stdout: one JSON object {ok, pr_url, branch, worktree, main, steps: [{step, ok, detail}]}
stderr: a single "error:" line on failure
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

EXIT_CODES = """\
exit 0  merged and cleaned up
exit 2  usage error, git/gh missing, gh pr view failed, or not run inside a linked worktree
exit 3  refused: pull request closed, wrong branch, dirty worktree, or unpushed commits
exit 4  gh pr merge failed; nothing else changed
exit 5  remote branch delete failed; pull request merged, worktree kept
exit 6  git worktree remove failed; pull request merged, worktree kept
exit 7  git branch -D failed; worktree removed
exit 8  git fetch failed; everything else done
exit 9  base branch fast-forward failed (local base diverged or conflicts); everything else done"""

PR_URL = re.compile(r"^https?://([^/]+)/([^/]+)/([^/]+)/pull/(\d+)/?$")


class Fail(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)


def detail(proc) -> str:
    for text in (proc.stderr, proc.stdout):
        lines = (text or "").strip().splitlines()
        if lines:
            return lines[0]
    return ""


def git(*args, cwd=None):
    return run(["git", *args], cwd=cwd)


def preconditions(url: str) -> dict:
    match = PR_URL.match(url)
    if not match:
        raise Fail(2, f"not a pull request URL (expected https://github.com/OWNER/REPO/pull/N): {url}")
    host, owner, repo, _ = match.groups()
    for tool in ("git", "gh"):
        if not shutil.which(tool):
            raise Fail(2, f"{tool} is required")

    top = git("rev-parse", "--show-toplevel")
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir")
    if top.returncode != 0 or common.returncode != 0:
        raise Fail(2, "not inside a git checkout; run from the pull request's worktree")
    wt = Path(top.stdout.strip()).resolve()
    common_dir = Path(common.stdout.strip()).resolve()
    if common_dir.name != ".git":
        raise Fail(2, f"cannot find the main checkout from git common dir {common_dir}")
    main = common_dir.parent
    if main == wt:
        raise Fail(2, f"{wt} is the main checkout, not a linked worktree; run from the pull request's worktree")

    view = run(["gh", "pr", "view", url, "--json", "state,headRefName,headRefOid,baseRefName,url"])
    if view.returncode != 0:
        raise Fail(2, f"gh pr view failed: {detail(view) or 'no output'}")
    try:
        pr = json.loads(view.stdout)
    except ValueError:
        raise Fail(2, "gh pr view did not print JSON")
    state, branch = pr.get("state"), pr.get("headRefName") or ""
    if state not in ("OPEN", "MERGED"):
        raise Fail(3, f"pull request is {state}, not OPEN: nothing to merge")
    current = git("branch", "--show-current").stdout.strip()
    if current != branch:
        raise Fail(3, f"current branch {current or '(detached)'} is not the head branch {branch}")

    status = git("status", "--porcelain")
    if status.returncode != 0:
        raise Fail(2, f"git status failed: {detail(status)}")
    if status.stdout.strip():
        count = len(status.stdout.strip().splitlines())
        raise Fail(3, f"worktree has {count} uncommitted or untracked path(s); commit and push them first")

    # Commits on HEAD that are on no remote-tracking branch and not in the PR head
    # would be lost by branch -D. The PR head covers a retry after the remote ref is pruned.
    unpushed_cmd = ["rev-list", "HEAD", "--not", "--remotes"]
    oid = pr.get("headRefOid") or ""
    if oid and git("cat-file", "-e", f"{oid}^{{commit}}").returncode == 0:
        unpushed_cmd.append(oid)
    unpushed = git(*unpushed_cmd)
    if unpushed.returncode != 0:
        raise Fail(2, f"git rev-list failed: {detail(unpushed)}")
    if unpushed.stdout.strip():
        count = len(unpushed.stdout.strip().splitlines())
        raise Fail(3, f"{count} commit(s) not pushed; run git push first")

    return {"host": host, "owner": owner, "repo": repo, "state": state, "branch": branch,
            "base": pr.get("baseRefName") or "", "wt": wt, "main": main, "url": pr.get("url") or url}


def finish(url: str, summary: dict) -> None:
    info = preconditions(url)
    branch, wt, main = info["branch"], info["wt"], info["main"]
    summary.update(branch=branch, worktree=str(wt), main=str(main))
    steps = summary["steps"]

    def step(name: str, ok: bool, text: str, code: int):
        steps.append({"step": name, "ok": ok, "detail": text})
        if not ok:
            raise Fail(code, f"{name} failed: {text}")

    if info["state"] == "MERGED":
        step("merge", True, "already merged", 4)
    else:
        merge = run(["gh", "pr", "merge", url, "--squash"], cwd=str(main))
        step("merge", merge.returncode == 0, detail(merge) or "squash-merged", 4)

    api = ["gh", "api", "-X", "DELETE",
           f"repos/{info['owner']}/{info['repo']}/git/refs/heads/{quote(branch, safe='/')}"]
    if info["host"] != "github.com":
        api[2:2] = ["--hostname", info["host"]]
    delete = run(api, cwd=str(main))
    gone = re.search(r"HTTP 404|HTTP 422|Reference does not exist", delete.stderr + delete.stdout)
    if delete.returncode == 0:
        step("delete_remote", True, f"deleted origin/{branch}", 5)
    else:
        step("delete_remote", bool(gone), "already deleted" if gone else detail(delete) or "gh api failed", 5)

    remove = git("-C", str(main), "worktree", "remove", str(wt), cwd=str(main))
    step("remove_worktree", remove.returncode == 0, detail(remove) or f"removed {wt}", 6)

    if git("-C", str(main), "show-ref", "--verify", "--quiet", f"refs/heads/{branch}",
           cwd=str(main)).returncode != 0:
        step("delete_branch", True, "already deleted", 7)
    else:
        drop = git("-C", str(main), "branch", "-D", branch, cwd=str(main))
        step("delete_branch", drop.returncode == 0, detail(drop) or f"deleted {branch}", 7)

    fetch = git("-C", str(main), "fetch", "--quiet", "--prune", "origin", cwd=str(main))
    step("fetch", fetch.returncode == 0, detail(fetch) or "fetched origin", 8)

    base = info["base"] or git("-C", str(main), "symbolic-ref", "--short", "refs/remotes/origin/HEAD",
                               cwd=str(main)).stdout.strip().removeprefix("origin/")
    summary["base"] = base or None
    on = git("-C", str(main), "branch", "--show-current", cwd=str(main)).stdout.strip()
    if not base:
        step("update_base", True, "skipped: base branch unknown", 9)
    elif on == base:
        ff = git("-C", str(main), "merge", "--ff-only", "--quiet", f"origin/{base}", cwd=str(main))
        step("update_base", ff.returncode == 0, detail(ff) or f"fast-forwarded {base}", 9)
    elif git("-C", str(main), "show-ref", "--verify", "--quiet", f"refs/heads/{base}",
             cwd=str(main)).returncode != 0:
        step("update_base", True, f"skipped: no local {base} branch", 9)
    else:
        ff = git("-C", str(main), "fetch", "--quiet", "origin", f"{base}:{base}", cwd=str(main))
        step("update_base", ff.returncode == 0, detail(ff) or f"fast-forwarded {base}", 9)
    summary["ok"] = True


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Squash-merge a pull request, delete its remote and local branch, and remove "
                    "the worktree you run it from. Refuses on uncommitted or unpushed work.",
        epilog=EXIT_CODES + "\n\nexample: finish.py https://github.com/acme/app/pull/12\n"
               "example: cd ../app-12-name && finish.py https://github.com/acme/app/pull/12",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("pr_url", help="GitHub pull request URL")

    def usage_error(message: str):  # keep the one "error:" line contract
        print(f"error: {message}", file=sys.stderr)
        sys.exit(2)

    parser.error = usage_error
    args = parser.parse_args(argv)
    summary = {"ok": False, "pr_url": args.pr_url, "branch": None, "base": None, "worktree": None,
               "main": None, "steps": []}
    code = 0
    try:
        finish(args.pr_url, summary)
    except Fail as exc:
        print(f"error: {exc}", file=sys.stderr)
        code = exc.code
    json.dump(summary, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
