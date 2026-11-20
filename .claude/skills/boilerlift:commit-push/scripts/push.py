#!/usr/bin/env python3
"""Push the current branch to its upstream, or to origin/[branch] with -u when it has none.

- never --force, never --no-verify
- non-fast-forward rejection: git pull --rebase --autostash once, then push once more
- rebase conflict: git rebase --abort, stop
- nothing ahead of the remote: push nothing, status up_to_date

stdout: one JSON object
stderr: a single "error:" line on failure
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

EXIT_CODES = """\
exit 0  pushed, or already up to date
exit 2  usage error, git missing, or not inside a git repository
exit 3  detached HEAD, rebase or merge in progress, or the remote does not exist
exit 4  git fetch failed (network, auth)
exit 5  push rejected for another reason (protected branch, hook, auth), or still rejected after the rebase
exit 6  rebase conflict: the rebase was aborted, nothing pushed"""

# Commit lines shown in the JSON. Enough to report a session's commits, small enough for the context.
MAX_COMMITS = 20

# git prints one of these on a non-fast-forward rejection. Git runs with LC_ALL=C so the text is stable.
REJECTED_NFF = ("non-fast-forward", "fetch first")
GIT_ENV = {**os.environ, "LC_ALL": "C"}


class Fail(Exception):
    def __init__(self, code: int, msg: str, extra: dict | None = None):
        super().__init__(msg)
        self.code = code
        self.extra = extra or {}


def run(repo: Path, *args: str):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=False, env=GIT_ENV)


def out(repo: Path, *args: str) -> str:
    proc = run(repo, *args)
    return proc.stdout.strip() if proc.returncode == 0 else ""


def first_line(proc) -> str:
    lines = [l for l in (proc.stderr or proc.stdout or "").strip().splitlines() if l.strip()]
    hints = [l for l in lines if l.startswith(("error:", "fatal:", "remote:", " ! "))]
    return (hints or lines or ["no output"])[0].strip()


def ref_exists(repo: Path, ref: str) -> bool:
    return run(repo, "show-ref", "--verify", "--quiet", ref).returncode == 0


def target(repo: Path, branch: str) -> tuple[str, str, bool]:
    """Return (remote, remote_branch, has_upstream)."""
    remote = out(repo, "config", f"branch.{branch}.remote")
    merge = out(repo, "config", f"branch.{branch}.merge")
    if remote and remote != "." and merge.startswith("refs/heads/"):
        return remote, merge[len("refs/heads/"):], True
    return "origin", branch, False


def pending(repo: Path, remote: str, remote_branch: str) -> list[str]:
    tracking = f"refs/remotes/{remote}/{remote_branch}"
    if ref_exists(repo, tracking):
        rng = [f"{tracking}..HEAD"]
    else:
        rng = ["HEAD", "--not", f"--remotes={remote}"]
    log = out(repo, "log", "--oneline", f"-{MAX_COMMITS + 1}", *rng)
    return log.splitlines() if log else []


def push(repo: Path, remote: str, remote_branch: str, branch: str, has_upstream: bool):
    if has_upstream:
        return run(repo, "push", remote, f"HEAD:refs/heads/{remote_branch}")
    return run(repo, "push", "-u", remote, f"{branch}:refs/heads/{remote_branch}")


def main_flow(args) -> dict:
    if not shutil.which("git"):
        raise Fail(2, "git is required")
    top = subprocess.run(["git", "-C", args.repo, "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, check=False, env=GIT_ENV)
    if top.returncode != 0:
        raise Fail(2, f"not inside a git repository: {args.repo}")
    repo = Path(top.stdout.strip())

    branch = out(repo, "symbolic-ref", "--short", "-q", "HEAD")
    if not branch:
        raise Fail(3, "detached HEAD: check out a branch before pushing")
    git_dir = Path(out(repo, "rev-parse", "--absolute-git-dir"))
    for marker, what in (("rebase-merge", "rebase"), ("rebase-apply", "rebase"), ("MERGE_HEAD", "merge")):
        if (git_dir / marker).exists():
            raise Fail(3, f"a {what} is in progress: finish or abort it first")

    remote, remote_branch, has_upstream = target(repo, branch)
    if remote not in out(repo, "remote").splitlines():
        raise Fail(3, f"remote '{remote}' does not exist: add it with git remote add {remote} [url]")

    fetch = run(repo, "fetch", remote)
    if fetch.returncode != 0:
        raise Fail(4, f"git fetch {remote} failed: {first_line(fetch)}")

    commits = pending(repo, remote, remote_branch)
    result = {
        "branch": branch,
        "remote": remote,
        "remote_branch": remote_branch,
        "upstream_set": not has_upstream,
        "rebased": False,
        "commits": commits[:MAX_COMMITS],
        "more_commits": len(commits) > MAX_COMMITS,
        "warnings": [],
    }
    new_remote_branch = not has_upstream and not ref_exists(repo, f"refs/remotes/{remote}/{remote_branch}")
    if not commits and not new_remote_branch:
        result.update(status="up_to_date", upstream_set=False)
        return result
    if args.dry_run:
        result.update(status="dry_run")
        return result

    proc = push(repo, remote, remote_branch, branch, has_upstream)
    if proc.returncode != 0:
        text = (proc.stderr or "") + (proc.stdout or "")
        if not any(marker in text for marker in REJECTED_NFF) or "protected" in text.lower():
            raise Fail(5, f"push rejected: {first_line(proc)}")
        rebase = run(repo, "pull", "--rebase", "--autostash", remote, remote_branch)
        if rebase.returncode != 0:
            conflicts = out(repo, "diff", "--name-only", "--diff-filter=U").splitlines()
            if any((git_dir / m).exists() for m in ("rebase-merge", "rebase-apply")):
                run(repo, "rebase", "--abort")
                raise Fail(6, f"rebase onto {remote}/{remote_branch} conflicted; rebase aborted, nothing pushed",
                           {"conflicts": conflicts})
            raise Fail(4, f"git pull --rebase {remote} {remote_branch} failed: {first_line(rebase)}")
        result["rebased"] = True
        # git exits 0 when re-applying the autostash conflicts: the edits stay in the stash.
        if "autostash resulted in conflicts" in (rebase.stdout + rebase.stderr).lower():
            result["warnings"].append("uncommitted changes conflicted after the rebase; they are kept in git stash")
        result["commits"] = pending(repo, remote, remote_branch)[:MAX_COMMITS]
        proc = push(repo, remote, remote_branch, branch, has_upstream)
        if proc.returncode != 0:
            raise Fail(5, f"push still rejected after the rebase: {first_line(proc)}")

    result["status"] = "pushed"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Push the current branch (master included) to its upstream; rebase once on a non-fast-forward.",
        epilog=EXIT_CODES + "\n\nexamples:\n  python3 push.py\n  python3 push.py --repo ../app --dry-run",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--repo", default=".", help="any path inside the repository (default: .)")
    parser.add_argument("--dry-run", action="store_true", help="fetch and list what would be pushed, push nothing")
    args = parser.parse_args()
    try:
        print(json.dumps(main_flow(args), indent=2))
        return 0
    except Fail as exc:
        if exc.extra:
            print(json.dumps({"error": str(exc), **exc.extra}, indent=2))
        print(f"error: {exc}", file=sys.stderr)
        return exc.code


if __name__ == "__main__":
    sys.exit(main())
