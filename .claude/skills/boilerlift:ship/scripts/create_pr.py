#!/usr/bin/env python3
"""Create the local-implementation worktree and its GitHub pull request.

Branch and pull request rules:
- base is the default branch from origin/HEAD (never update git config)
- worktree is the sibling ../{RepoName}-{lastSegment}
- stop if the local branch, origin branch, sibling directory, or worktree exists,
  unless it is a resume: an OPEN pull request for the branch and the sibling
  worktree already on it (then nothing is created and the PR is reused)
- with --type/--id/--name, build the branch: prefix by Type, then a slug of
  "ID-Nom" with accents stripped, every other character run turned into "-",
  capped at SLUG_MAX characters on a "-" boundary
- replace {{BRANCH}} in the body with the branch
- never delete a branch, worktree, or env file
- empty commit, then push, no --no-verify
- gh pr create --title --base --body-file

Local-only additions: trust the worktree in ~/.claude.json and symlink untracked
.env* files. boilerlift:ship updates the Notion card itself through the Notion MCP.

stdout: one JSON object (no secrets)
stderr: warnings and a single "error:" line on failure
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(os.path.realpath(__file__)).parent))
from link_env_files import UsageError, link_env_files  # noqa: E402

EXIT_CODES = """\
exit 0  pull request created or resumed, or a dry-run that found no blocking collision
exit 2  usage error, or python3/git/gh missing
exit 3  git fetch failed, or origin/HEAD is unset
exit 4  branch, remote branch, directory, or worktree already exists and is not a resume,
        or --resume found nothing to resume
exit 5  git worktree add failed
exit 6  empty commit failed; worktree left in place
exit 7  git push failed; worktree left in place; no pull request
exit 8  gh pr create failed; worktree left in place
exit 9  env linker failed; worktree left in place; no commit"""

PREFIXES = {"story": "feature/", "bug": "fix/", "tech story": "tech/"}
SLUG_MAX = 50
BRANCH_TOKEN = "{{BRANCH}}"


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def build_branch(kind: str, card_id: str, name: str) -> str:
    """Branch from the card's Type, ID and Nom: 'feature/', 'fix/', 'tech/' or no prefix."""
    id_slug, name_slug = slugify(card_id), slugify(name)
    if not id_slug:
        raise Fail(2, f"card ID has no letter or digit: {card_id!r}")
    if not name_slug:
        raise Fail(2, f"card Nom has no letter or digit: {name!r}")
    slug = f"{id_slug}-{name_slug}"
    if len(slug) > SLUG_MAX:
        cut = slug[:SLUG_MAX + 1].rsplit("-", 1)[0]
        slug = cut if len(cut) > len(id_slug) else slug[:SLUG_MAX].rstrip("-")
    return PREFIXES.get(kind.strip().lower(), "") + slug


class Fail(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=False)


def first_line(text: str) -> str:
    return (text or "").strip().splitlines()[0] if (text or "").strip() else ""


def detail(proc) -> str:
    line = first_line(proc.stderr) or first_line(proc.stdout)
    return f": {line}" if line else ""


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def collisions(root: Path, branch: str, wt: Path) -> list:
    found = []
    if run(["git", "-C", str(root), "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"]).returncode == 0:
        found.append(f"local branch refs/heads/{branch}")
    if run(["git", "-C", str(root), "show-ref", "--verify", "--quiet",
            f"refs/remotes/origin/{branch}"]).returncode == 0:
        found.append(f"remote branch refs/remotes/origin/{branch}")
    if wt.exists() or wt.is_symlink():
        found.append(f"directory {wt}")
    wt_real = os.path.realpath(wt)
    listing = run(["git", "-C", str(root), "worktree", "list", "--porcelain"]).stdout
    for line in listing.splitlines():
        if line.startswith("worktree "):
            listed = line[len("worktree "):]
            if listed == str(wt) or os.path.realpath(listed) == wt_real:
                found.append(f"worktree {listed}")
    return found


def resumable(root: Path, branch: str, wt: Path):
    """Return the OPEN pull request URL when the run can resume, else (None, reason)."""
    if not wt.is_dir():
        return None, "no sibling worktree to resume in"
    current = run(["git", "-C", str(wt), "branch", "--show-current"]).stdout.strip()
    if current != branch:
        return None, f"{wt} is on '{current or 'detached HEAD'}', not {branch}"
    prs = run(["gh", "pr", "list", "--head", branch, "--state", "open", "--json", "url"], cwd=str(root))
    if prs.returncode != 0:
        return None, f"gh pr list failed{detail(prs)}"
    try:
        urls = [item["url"] for item in json.loads(prs.stdout or "[]")]
    except (ValueError, KeyError, TypeError):
        return None, "gh pr list returned unreadable JSON"
    if len(urls) != 1:
        return None, f"{len(urls)} open pull requests for {branch}, need exactly 1"
    return urls[0], ""


def trust_worktree(path: Path) -> bool:
    """Mark the folder trusted in ~/.claude.json so the new session skips the dialog."""
    cfg = Path.home() / ".claude.json"
    try:
        data = json.loads(cfg.read_text(encoding="utf-8")) if cfg.exists() else {}
        projects = data.setdefault("projects", {})
        projects.setdefault(str(path), {})["hasTrustDialogAccepted"] = True
        fd, tmp = tempfile.mkstemp(prefix=".claude.json.", dir=str(cfg.parent))
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        if cfg.exists():
            shutil.copymode(cfg, tmp)
        os.replace(tmp, cfg)
        return True
    except (OSError, ValueError, AttributeError) as exc:
        warn(f"could not update {cfg}: worktree created but not trusted ({path}): {exc}")
        return False


def env_rows(rows) -> list:
    out = []
    for action, rel, reason in sorted(rows, key=lambda r: r[1]):
        item = {"path": rel, "action": action}
        if reason:
            item["reason"] = reason
        out.append(item)
    return out


def read_body(args, branch: str, root: Path) -> Path:
    """Read the body (file or stdin), fill the branch token, return the file gh reads."""
    if args.body_file == "-":
        fd, body_path = tempfile.mkstemp(prefix="ship-body.")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(sys.stdin.read())
        args.body_tmp = body_path
    else:
        body_path = args.body_file
    body = Path(body_path)
    if not body.is_file():
        raise Fail(2, f"body file not found: {body_path}")
    if body.stat().st_size == 0:
        raise Fail(2, "body file is empty")

    body_abs = Path(os.path.abspath(body))
    text = body.read_text(encoding="utf-8")
    if BRANCH_TOKEN in text:  # the agent doesn't know the built branch; fill it here
        fd, filled = tempfile.mkstemp(prefix="ship-body-filled.")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text.replace(BRANCH_TOKEN, branch))
        if args.body_tmp:
            os.unlink(args.body_tmp)
        args.body_tmp = filled
        body_abs = Path(filled)
    if body_abs == root or root in body_abs.parents:
        warn("body file is inside the repository; the empty commit does not add it")

    return body_abs


def create(args) -> dict:
    title = args.title
    card = (args.type, args.id, args.name)
    if args.branch and any(v is not None for v in card):
        raise Fail(2, "pass --branch or --type/--id/--name, not both")
    if args.branch:
        branch = args.branch
    elif args.id is not None and args.name is not None:
        branch = build_branch(args.type or "", args.id, args.name)
    else:
        raise Fail(2, "pass --branch, or --id and --name (with --type)")
    if args.resume and (title is not None or args.body_file is not None):
        raise Fail(2, "--resume reuses the open pull request: drop --title and --body-file")
    if not args.resume:
        if title is None or args.body_file is None:
            raise Fail(2, "--title and --body-file are required, unless --resume")
        if "\n" in title:
            raise Fail(2, "title must be one line")
        if not title.strip():
            raise Fail(2, "title is empty")
    for tool in ("git", "gh"):
        if not shutil.which(tool):
            raise Fail(2, f"{tool} is required")
    check = run(["git", "check-ref-format", "--branch", branch])
    if check.returncode != 0:
        raise Fail(2, f"branch name is not a valid git branch: {branch}")
    if check.stdout.strip() != branch:
        raise Fail(2, f"branch name is not a literal branch: {branch}")

    top = run(["git", "-C", args.repo, "rev-parse", "--show-toplevel"])
    if top.returncode != 0:
        raise Fail(2, f"not a git repository: {args.repo}")
    root = Path(top.stdout.strip())
    last = branch.rsplit("/", 1)[-1]
    if not last:
        raise Fail(2, "branch name has an empty last segment")
    wt = root.parent / f"{root.name}-{last}"

    fetch = run(["git", "-C", str(root), "fetch", "--quiet", "origin"])
    if fetch.returncode != 0:
        raise Fail(3, f"git fetch origin failed{detail(fetch)}")
    head = run(["git", "-C", str(root), "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
    base_ref = head.stdout.strip()
    if head.returncode != 0 or not base_ref.startswith("origin/") or base_ref == "origin/":
        raise Fail(3, "origin/HEAD is unset")
    base = base_ref[len("origin/"):]

    summary = {"ok": True, "dry_run": args.dry_run, "resumed": False, "pr_url": None, "branch": branch,
               "base": base, "worktree": str(wt), "trusted": False}
    found = collisions(root, branch, wt)
    if found:
        url, reason = resumable(root, branch, wt)
        if not url:
            raise Fail(4, "refusing to create, already exists: " + "; ".join(dict.fromkeys(found))
                       + f" (not a resume: {reason})")
        wt = wt.resolve()
        summary.update(resumed=True, pr_url=url, worktree=str(wt))
        if title is not None or args.body_file is not None:
            warn(f"resumed {url}: its title and body are unchanged; --title and --body-file were ignored")
        if not args.dry_run:
            summary["trusted"] = trust_worktree(wt)
        try:
            summary["env_files"] = env_rows(link_env_files(str(root), str(wt), dry_run=args.dry_run))
        except UsageError as exc:
            raise Fail(9, f"env link failed: {exc}")
        return summary
    if args.resume:
        raise Fail(4, f"nothing to resume for {branch}: no local branch, remote branch or worktree")

    body_abs = read_body(args, branch, root)
    if args.dry_run:
        try:
            summary["env_files"] = env_rows(link_env_files(str(root), str(wt), dry_run=True))
        except UsageError as exc:
            raise Fail(9, f"env link dry-run failed: {exc}")
        return summary

    add = run(["git", "-C", str(root), "worktree", "add", str(wt), "-b", branch, "origin/HEAD"])
    if add.returncode != 0:
        raise Fail(5, f"worktree add failed{detail(add)}")
    wt = wt.resolve()
    summary["worktree"] = str(wt)
    summary["trusted"] = trust_worktree(wt)
    args.keep_body = True  # from here on, a failure keeps the body for a manual retry

    try:
        summary["env_files"] = env_rows(link_env_files(str(root), str(wt)))
    except UsageError as exc:
        raise Fail(9, f"env link failed: {exc}")

    commit = run(["git", "-C", str(wt), "commit", "--allow-empty", "-m", title])
    if commit.returncode != 0:
        raise Fail(6, f"empty commit failed{detail(commit)}")
    push = run(["git", "-C", str(wt), "push", "--quiet", "-u", "origin", "HEAD"])
    if push.returncode != 0:
        raise Fail(7, f"git push failed{detail(push)}")
    pr = run(["gh", "pr", "create", "--title", title, "--base", base, "--body-file", str(body_abs)],
             cwd=str(wt))
    if pr.returncode != 0:
        raise Fail(8, f"gh pr create failed{detail(pr)}")
    urls = re.findall(r"https://\S+", pr.stdout)
    if not urls:
        raise Fail(8, "gh pr create did not print a pull request URL")
    summary["pr_url"] = urls[-1]
    args.keep_body = False
    return summary


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Create a sibling worktree, push an empty commit, and open a pull request. "
                    "Symlink untracked .env* files into the worktree; never print their contents.",
        epilog=EXIT_CODES + "\n\n"
        "example: create_pr.py --title 'feat(x): y' --type story --id APP-12 --name 'Do y' --body-file - <<'EOF'",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--title", help="Conventional Commits subject (not with --resume)")
    parser.add_argument("--branch", help="exact branch to create, e.g. feature/12-name")
    parser.add_argument("--type", help="card Type: story, bug, tech story (picks the branch prefix)")
    parser.add_argument("--id", help="card ID, e.g. BOILERLIFT-14")
    parser.add_argument("--name", help="card Nom; slugged and capped with the ID")
    parser.add_argument("--body-file", help="pull request body; - reads stdin (not with --resume)")
    parser.add_argument("--resume", action="store_true",
                        help="reuse the open pull request and worktree of --branch; never create")
    parser.add_argument("--repo", default=".", help="git working tree to branch from (default: .)")
    parser.add_argument("--dry-run", action="store_true", help="check collisions, list env files, create nothing")
    def usage_error(message: str):  # keep the one "error:" line contract
        print(f"error: {message}", file=sys.stderr)
        sys.exit(2)

    parser.error = usage_error
    args = parser.parse_args(argv)
    args.body_tmp, args.keep_body = None, False
    try:
        summary = create(args)
    except Fail as exc:
        print(f"error: {exc}", file=sys.stderr)
        return exc.code
    finally:
        if args.body_tmp:
            if args.keep_body:
                warn(f"body kept at {args.body_tmp}")
            else:
                os.unlink(args.body_tmp)
    json.dump(summary, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
