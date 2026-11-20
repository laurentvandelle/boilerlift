#!/usr/bin/env python3
"""Exercise finish.py against a local bare remote and a fake gh.

Run: python3 scripts/test_finish.py   (prints "ok", exits 1 on the first failure)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
MAIN = SCRIPTS / "finish.py"
PR = "https://github.com/example/demo/pull/7"

FAKE_GH = r'''#!/usr/bin/env python3
import json, os, subprocess, sys
args = sys.argv[1:]
with open(os.environ["GH_LOG"], "a") as log:
    log.write(os.getcwd() + "\t" + " ".join(args) + "\n")
state_path = os.environ["GH_STATE"]
state = json.load(open(state_path))
if args[:2] == ["pr", "view"]:
    print(json.dumps(state))
    sys.exit(0)
if args[:2] == ["pr", "merge"]:
    if os.environ.get("GH_MERGE_FAIL"):
        print("GraphQL: Pull request is not mergeable", file=sys.stderr)
        sys.exit(1)
    state["state"] = "MERGED"
    json.dump(state, open(state_path, "w"))
    sys.exit(0)
if args[:3] == ["api", "-X", "DELETE"]:
    ref = args[3].split("/git/", 1)[1]
    remote = os.environ["GH_REMOTE"]
    if subprocess.run(["git", "--git-dir", remote, "show-ref", "--verify", "--quiet", ref]).returncode:
        print("gh: Reference does not exist (HTTP 422)", file=sys.stderr)
        sys.exit(1)
    subprocess.run(["git", "--git-dir", remote, "update-ref", "-d", ref], check=True)
    sys.exit(0)
print("unexpected gh: " + " ".join(args), file=sys.stderr)
sys.exit(1)
'''


def fail(msg: str):
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def check(cond, msg: str):
    if not cond:
        fail(msg)


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], capture_output=True, text=True, check=False, **kw)


def git(*args):
    out = run(["git", *args])
    check(out.returncode == 0, f"git {' '.join(map(str, args))}: {out.stderr.strip()}")
    return out.stdout.strip()


def has_ref(repo, ref, bare=False) -> bool:
    flag = "--git-dir" if bare else "-C"
    return run(["git", flag, repo, "show-ref", "--verify", "--quiet", ref]).returncode == 0


def static_checks():
    for path in (MAIN, Path(__file__)):
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except SyntaxError as exc:
            fail(f"{path.name} does not compile: {exc}")
        check(os.access(path, os.X_OK), f"{path.name} is not executable")
    forbidden = re.compile(r'"--force"|"-f"|rmtree|os\.remove\(|unlink\(|"--no-verify"')
    for n, line in enumerate(MAIN.read_text(encoding="utf-8").splitlines(), 1):
        check(not forbidden.search(line), f"finish.py:{n} contains a forbidden operation")
    lines = (ROOT / "SKILL.md").read_text(encoding="utf-8").splitlines()
    check(len(lines) < 500, f"SKILL.md has {len(lines)} lines")


def flow_checks(tmp: Path):
    home = tmp / "home"
    home.mkdir()
    (home / ".gitconfig").touch()
    gh_log, gh_state = tmp / "gh.log", tmp / "gh-state.json"
    remote, demo = tmp / "remote.git", tmp / "demo"
    os.environ.update(HOME=str(home), GIT_CONFIG_GLOBAL=str(home / ".gitconfig"), GIT_CONFIG_NOSYSTEM="1",
                      GH_LOG=str(gh_log), GH_STATE=str(gh_state), GH_REMOTE=str(remote))
    os.environ.pop("GH_MERGE_FAIL", None)
    bin_dir = tmp / "bin"
    bin_dir.mkdir()
    (bin_dir / "gh").write_text(FAKE_GH)
    (bin_dir / "gh").chmod(0o755)
    os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ['PATH']}"

    def identity(repo):
        git("-C", repo, "config", "user.email", "test@example.com")
        git("-C", repo, "config", "user.name", "Test")

    git("init", "-q", "--bare", "-b", "master", remote)
    git("clone", "-q", remote, demo)
    identity(demo)
    (demo / "README.md").write_text("hello\n")
    (demo / ".gitignore").write_text(".env\nnode_modules/\n")
    (demo / ".env").write_text("SECRET=1\n")
    git("-C", demo, "add", "README.md", ".gitignore")
    git("-C", demo, "commit", "-q", "-m", "chore: init")
    git("-C", demo, "push", "-q", "-u", "origin", "HEAD")

    def make_worktree(branch: str, name: str) -> Path:
        wt = tmp / name
        git("-C", demo, "worktree", "add", "-q", "-b", branch, wt, "origin/master")
        (wt / ".env").symlink_to(demo / ".env")  # ignored env link, like boilerlift:ship makes
        (wt / "node_modules").mkdir()
        (wt / "node_modules" / "dep.js").write_text("x\n")
        (wt / "feature.txt").write_text("feature\n")
        git("-C", wt, "add", "feature.txt")
        git("-C", wt, "commit", "-q", "-m", "feat: add feature")
        git("-C", wt, "push", "-q", "-u", "origin", "HEAD")
        return wt

    def set_state(state: str, branch: str, wt: Path):
        gh_state.write_text(json.dumps({"state": state, "headRefName": branch, "baseRefName": "master", "url": PR,
                                        "headRefOid": git("-C", wt, "rev-parse", "HEAD")}))

    def finish(cwd: Path):
        gh_log.write_text("")
        out = run([sys.executable, MAIN, PR], cwd=str(cwd))
        try:
            data = json.loads(out.stdout)
        except ValueError:
            fail(f"stdout is not JSON (exit {out.returncode}): {out.stdout!r} {out.stderr!r}")
        if out.returncode:
            err = out.stderr.strip().splitlines()
            check(len(err) == 1 and err[0].startswith("error:"), f"stderr is not one error line: {out.stderr!r}")
        return out, data

    def gh_calls():
        return [line.split("\t", 1) for line in gh_log.read_text().splitlines()]

    branch = "feature/12-thing"
    wt = make_worktree(branch, "demo-12-thing")
    set_state("OPEN", branch, wt)

    # Dirty tracked file: refuse before any gh call except pr view.
    (wt / "README.md").write_text("changed\n")
    out, data = finish(wt)
    check(out.returncode == 3 and "uncommitted" in out.stderr, f"dirty: {out.returncode} {out.stderr}")
    check(data["steps"] == [] and data["ok"] is False, "dirty ran steps")
    check(all(args.startswith("pr view") for _, args in gh_calls()), "dirty called gh beyond pr view")
    git("-C", wt, "checkout", "-q", "--", "README.md")

    # Untracked file: refuse.
    (wt / "notes.txt").write_text("todo\n")
    out, _ = finish(wt)
    check(out.returncode == 3 and "untracked" in out.stderr, f"untracked: {out.returncode} {out.stderr}")
    (wt / "notes.txt").unlink()

    # Unpushed commit: refuse, then push.
    (wt / "more.txt").write_text("more\n")
    git("-C", wt, "add", "more.txt")
    git("-C", wt, "commit", "-q", "-m", "feat: more")
    out, _ = finish(wt)
    check(out.returncode == 3 and "not pushed" in out.stderr, f"unpushed: {out.returncode} {out.stderr}")
    git("-C", wt, "push", "-q")
    set_state("OPEN", branch, wt)

    # Closed pull request: refuse.
    set_state("CLOSED", branch, wt)
    out, _ = finish(wt)
    check(out.returncode == 3 and "CLOSED" in out.stderr, f"closed: {out.returncode} {out.stderr}")
    set_state("OPEN", branch, wt)

    # Run from the main checkout: refuse.
    out, _ = finish(demo)
    check(out.returncode == 2 and "main checkout" in out.stderr, f"main: {out.returncode} {out.stderr}")

    # Merge failure stops before touching branches or the worktree.
    os.environ["GH_MERGE_FAIL"] = "1"
    out, data = finish(wt)
    del os.environ["GH_MERGE_FAIL"]
    check(out.returncode == 4 and "not mergeable" in out.stderr, f"merge fail: {out.returncode} {out.stderr}")
    check([s["step"] for s in data["steps"]] == ["merge"] and not data["steps"][0]["ok"], "merge fail steps")
    check(wt.exists() and has_ref(remote, f"refs/heads/{branch}", bare=True), "merge fail cleaned up")

    # Happy path: the squash commit lands on origin/master; the main checkout's master follows it.
    other = tmp / "other"
    git("clone", "-q", remote, other)
    identity(other)
    (other / "squash.txt").write_text("squash\n")
    git("-C", other, "add", "squash.txt")
    git("-C", other, "commit", "-q", "-m", "feat: squash")
    git("-C", other, "push", "-q")
    out, data = finish(wt)
    check(out.returncode == 0, f"finish exited {out.returncode}: {out.stderr}")
    check(data["ok"] is True and data["branch"] == branch, "summary")
    check(data["worktree"] == str(wt.resolve()) and data["main"] == str(demo.resolve()), "summary paths")
    steps = [(s["step"], s["ok"]) for s in data["steps"]]
    check(steps == [("merge", True), ("delete_remote", True), ("remove_worktree", True),
                    ("delete_branch", True), ("fetch", True), ("update_base", True)], f"steps {steps}")
    check(data["base"] == "master", f"base {data['base']}")
    check(git("-C", demo, "rev-parse", "master") == git("-C", other, "rev-parse", "HEAD"),
          "main checkout master not fast-forwarded")
    check((demo / "squash.txt").exists(), "main checkout files not updated")
    calls = gh_calls()
    merge = [c for c in calls if c[1].startswith("pr merge")]
    check(len(merge) == 1 and merge[0][1] == f"pr merge {PR} --squash", f"merge call {merge}")
    check(os.path.realpath(merge[0][0]) == os.path.realpath(demo), "merge did not run in the main checkout")
    check(any(c[1] == f"api -X DELETE repos/example/demo/git/refs/heads/{branch}" for c in calls),
          f"api call {calls}")
    check(not has_ref(remote, f"refs/heads/{branch}", bare=True), "remote branch still there")
    check(not wt.exists(), "worktree directory still there")
    check(str(wt) not in git("-C", demo, "worktree", "list"), "worktree still listed")
    check(not has_ref(demo, f"refs/heads/{branch}"), "local branch still there")
    check(not has_ref(demo, f"refs/remotes/origin/{branch}"), "stale origin ref not pruned")
    check((demo / ".env").read_text() == "SECRET=1\n", "env file target was touched")

    # Retry after a partial run: already merged, remote branch already gone.
    branch2 = "feature/13-other"
    wt2 = make_worktree(branch2, "demo-13-other")
    set_state("MERGED", branch2, wt2)
    git("--git-dir", remote, "update-ref", "-d", f"refs/heads/{branch2}")
    git("-C", demo, "fetch", "-q", "--prune", "origin")
    out, data = finish(wt2)
    check(out.returncode == 0, f"retry exited {out.returncode}: {out.stderr}")
    details = {s["step"]: s["detail"] for s in data["steps"]}
    check(details["merge"] == "already merged" and details["delete_remote"] == "already deleted",
          f"retry details {details}")
    check(not any(c[1].startswith("pr merge") for c in gh_calls()), "retry merged again")
    check(not wt2.exists() and not has_ref(demo, f"refs/heads/{branch2}"), "retry did not clean up")

    # Diverged local master: everything else done, exit 9.
    branch3 = "feature/14-diverged"
    wt3 = make_worktree(branch3, "demo-14-diverged")
    set_state("OPEN", branch3, wt3)
    (other / "later.txt").write_text("later\n")
    git("-C", other, "add", "later.txt")
    git("-C", other, "commit", "-q", "-m", "feat: later")
    git("-C", other, "push", "-q")
    (demo / "local.txt").write_text("local\n")
    git("-C", demo, "add", "local.txt")
    git("-C", demo, "commit", "-q", "-m", "chore: local only")
    out, data = finish(wt3)
    check(out.returncode == 9 and "update_base" in out.stderr, f"diverged: {out.returncode} {out.stderr}")
    check(data["steps"][-1]["step"] == "update_base" and not wt3.exists(), f"diverged steps {data['steps']}")

    usage = run([sys.executable, MAIN])
    check(usage.returncode == 2 and usage.stderr.startswith("error:"), f"usage: {usage.stderr}")
    bad = run([sys.executable, MAIN, "https://example.com/nope"])
    check(bad.returncode == 2 and "not a pull request URL" in bad.stderr, f"bad url: {bad.stderr}")
    helped = run([sys.executable, MAIN, "--help"])
    check(helped.returncode == 0 and "exit 9" in helped.stdout, "--help lacks the exit codes")


def main() -> int:
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    static_checks()
    tmp = Path(tempfile.mkdtemp(prefix="test-finish."))
    saved = dict(os.environ)
    try:
        flow_checks(tmp)
    finally:
        os.environ.clear()
        os.environ.update(saved)
        shutil.rmtree(tmp, ignore_errors=True)
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
