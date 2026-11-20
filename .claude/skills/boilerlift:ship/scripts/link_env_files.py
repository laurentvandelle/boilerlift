#!/usr/bin/env python3
"""Symlink untracked .env* files from one worktree into another.

Symlinks only. Never overwrites. Never prints file contents.

A basename matches when it starts with ".env" (.env, .env.local, .envrc).
Tracked files are skipped: the destination checkout already has them.
Ignored files are included. Dependency and build directories are not walked.

stdout: TSV  action<TAB>relative-path<TAB>reason
  action: linked | skipped | error | would-link
stderr: one short line per file, no contents
exit 0  walk finished (per-file problems are TSV "error" rows)
exit 2  usage error, or source/dest cannot be used
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Dependencies, build output and VCS metadata: never app env files.
PRUNED = {".git", "node_modules", ".yarn", "dist", "build", ".next", "coverage"}


class UsageError(Exception):
    pass


def tracked(source: Path) -> set:
    out = subprocess.run(
        ["git", "-C", str(source), "ls-files", "-z"],
        capture_output=True, text=True, check=False,
    )
    return set(filter(None, out.stdout.split("\0")))


def candidates(source: Path):
    for dirpath, dirnames, filenames in os.walk(source, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in PRUNED)
        # A symlink to a directory shows up in dirnames; it is not an env file.
        for name in sorted(filenames):
            if not name.startswith(".env"):
                continue
            full = Path(dirpath) / name
            if full.is_dir():
                continue
            yield full.relative_to(source).as_posix(), full


def link_env_files(source: str, dest: str, dry_run: bool = False) -> list:
    """Return [(action, rel, reason)]. Raises UsageError for unusable dirs."""
    src = Path(source)
    if not src.is_dir():
        raise UsageError(f"source is not a directory: {source}")
    dst = Path(dest)
    if not dry_run and not dst.is_dir():
        raise UsageError(f"dest is not a directory: {dest}")
    probe = subprocess.run(
        ["git", "-C", str(src), "rev-parse", "--show-toplevel"],
        capture_output=True, text=True, check=False,
    )
    if probe.returncode != 0:
        raise UsageError(f"source is not a git worktree: {source}")

    src = src.resolve()
    dst_phys = dst.resolve() if dst.exists() else Path(os.path.abspath(dst))
    if src == dst_phys:
        raise UsageError("source and dest are the same directory")

    in_git = tracked(src)
    rows = []
    for rel, full in candidates(src):
        if "\n" in rel or "\t" in rel:
            rows.append(("error", rel.replace("\n", "?").replace("\t", "?"), "unsupported path"))
            continue
        if rel in in_git:
            continue
        if dry_run:
            rows.append(("would-link", rel, ""))
            continue
        target = dst_phys / rel
        if target.exists() or target.is_symlink():
            if target.is_symlink() and os.path.realpath(target) == os.path.realpath(full):
                rows.append(("linked", rel, ""))
            else:
                rows.append(("skipped", rel, "exists"))
            continue
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            rows.append(("error", rel, "could not create parent directory"))
            continue
        parent = target.parent.resolve()
        if parent != dst_phys and dst_phys not in parent.parents:
            rows.append(("error", rel, "parent escaped the destination"))
            continue
        try:
            os.symlink(os.path.relpath(full, parent), target)
        except OSError:
            rows.append(("error", rel, "symlink failed"))
            continue
        rows.append(("linked", rel, ""))
    return rows


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Symlink untracked .env* files from --source into --dest, including nested "
                    "files. Does not overwrite. Does not print file contents.",
        epilog="exit 0 walk finished; exit 2 usage error or unusable source/dest.\n"
               "example: link_env_files.py --source ~/code/app --dest ~/code/app-12-x --dry-run",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--source", required=True, help="worktree that holds the env files")
    parser.add_argument("--dest", required=True, help="worktree that receives the symlinks")
    parser.add_argument("--dry-run", action="store_true", help="print would-link rows, create nothing")
    args = parser.parse_args(argv)
    try:
        rows = link_env_files(args.source, args.dest, args.dry_run)
    except UsageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    for action, rel, reason in rows:
        print(f"{action}\t{rel}\t{reason}")
        print(f"{action} {rel}" + (f" ({reason})" if reason else ""), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
