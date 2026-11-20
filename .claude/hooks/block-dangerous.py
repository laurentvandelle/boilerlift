#!/usr/bin/env python3
"""PreToolUse hook: block destructive bash before Claude Code runs it.

stdin is the Claude Code hook JSON. A blocked command prints one JSON object
and exits 2, which beats an allow rule. Anything else prints nothing and
exits 0, so permissions.allow / permissions.deny still decide.

Allow rules match command text from the left, so `git push origin --force`
is not covered by `Bash(git push --force *)`. This hook parses arguments.

Blocks:
- recursive rm (rm -r, rm -rf), including sudo, env, and sh -c
- git push --force, --force-with-lease, -f, a +refspec, or --delete
- git reset --hard
- git clean --force
- git add of a .env* path, and git add --force
- git commit/push --no-verify
- node -p / node -e that reads env files or spawns a process

The command text is not included in the deny reason.
"""

from __future__ import annotations

import json
import os
import shlex
import sys

SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "ash"}
WRAPPERS = {"command", "builtin", "time", "nice", "nohup", "noglob"}


def deny(reason: str) -> None:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )
    sys.stdout.write("\n")
    print(reason, file=sys.stderr)
    raise SystemExit(2)


def program_name(token: str) -> str:
    name = os.path.basename(token)
    if name.endswith(".exe"):
        name = name[:-4]
    return name


def split_segments(command: str) -> list[str]:
    """Split on &&, ||, ;, |, and newlines. Quotes are preserved for shlex."""
    parts: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(command)
    quote = ""
    while i < n:
        c = command[i]
        if quote:
            buf.append(c)
            if c == "\\" and quote == '"' and i + 1 < n:
                buf.append(command[i + 1])
                i += 2
                continue
            if c == quote:
                quote = ""
            i += 1
            continue
        if c in ("'", '"'):
            quote = c
            buf.append(c)
            i += 1
            continue
        if c == "\\" and i + 1 < n:
            buf.append(c)
            buf.append(command[i + 1])
            i += 2
            continue
        if command.startswith("&&", i) or command.startswith("||", i):
            parts.append("".join(buf))
            buf = []
            i += 2
            continue
        if c in ";\n|":
            parts.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    parts.append("".join(buf))
    return [part.strip() for part in parts if part.strip()]


def substitutions(command: str) -> list[str]:
    """Return $(...) and backtick bodies that are not inside single quotes."""
    found: list[str] = []
    i = 0
    n = len(command)
    quote = ""
    while i < n:
        c = command[i]
        if quote == "'":
            if c == "'":
                quote = ""
            i += 1
            continue
        if quote == '"':
            if c == "\\" and i + 1 < n:
                i += 2
                continue
            if c == '"':
                quote = ""
                i += 1
                continue
        elif c in ("'", '"'):
            quote = c
            i += 1
            continue
        if c == "`":
            end = command.find("`", i + 1)
            if end == -1:
                break
            found.append(command[i + 1 : end])
            i = end + 1
            continue
        if command.startswith("$(", i):
            depth = 1
            j = i + 2
            inner_quote = ""
            while j < n and depth:
                cj = command[j]
                if inner_quote:
                    if cj == "\\" and inner_quote == '"' and j + 1 < n:
                        j += 2
                        continue
                    if cj == inner_quote:
                        inner_quote = ""
                    j += 1
                    continue
                if cj in ("'", '"'):
                    inner_quote = cj
                    j += 1
                    continue
                if command.startswith("$(", j):
                    depth += 1
                    j += 2
                    continue
                if cj == ")":
                    depth -= 1
                    j += 1
                    continue
                j += 1
            if depth == 0:
                found.append(command[i + 2 : j - 1])
                i = j
                continue
        i += 1
    return found


def tokenize(segment: str) -> list[str] | None:
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return None


def strip_wrappers(tokens: list[str]) -> list[str]:
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if (
            "=" in token
            and not token.startswith("-")
            and token.split("=", 1)[0].replace("_", "a").isalnum()
        ):
            i += 1
            continue
        name = program_name(token)
        if name == "sudo":
            i += 1
            while i < len(tokens) and tokens[i].startswith("-"):
                if tokens[i] in ("-u", "-g", "-C", "-h", "-p", "-T") and i + 1 < len(tokens):
                    i += 2
                else:
                    i += 1
            continue
        if name == "env":
            i += 1
            while i < len(tokens):
                item = tokens[i]
                if item in ("-u", "-C", "-S") and i + 1 < len(tokens):
                    i += 2
                    continue
                if item.startswith("-") or ("=" in item and not item.startswith("-")):
                    i += 1
                    continue
                break
            continue
        if name == "timeout":
            i += 1
            while i < len(tokens) and tokens[i].startswith("-"):
                i += 1
            if i < len(tokens):
                i += 1
            continue
        if name == "stdbuf":
            i += 1
            while i < len(tokens) and tokens[i].startswith("-"):
                if tokens[i] in ("-i", "-o", "-e") and i + 1 < len(tokens):
                    i += 2
                else:
                    i += 1
            continue
        if name in WRAPPERS:
            i += 1
            continue
        break
    return tokens[i:]


def short_cluster(token: str) -> str:
    if token.startswith("-") and not token.startswith("--"):
        return token[1:]
    return ""


def is_env_basename(path: str) -> bool:
    base = os.path.basename(path.rstrip("/"))
    return base == ".env" or base.startswith(".env")


def check_rm(args: list[str]) -> None:
    for token in args:
        if token == "--":
            break
        if token in ("-r", "-R", "--recursive"):
            deny("recursive rm is blocked")
        if token.startswith("--") and token.startswith("--recursive"):
            deny("recursive rm is blocked")
        cluster = short_cluster(token)
        if "r" in cluster or "R" in cluster:
            deny("recursive rm is blocked")


def git_subcommand(args: list[str]) -> tuple[str | None, list[str]]:
    i = 0
    while i < len(args):
        token = args[i]
        if token in ("-C", "-c", "--git-dir", "--work-tree", "--namespace") and i + 1 < len(args):
            i += 2
            continue
        if token.startswith("--git-dir=") or token.startswith("--work-tree=") or token.startswith("--namespace="):
            i += 1
            continue
        if token.startswith("-C") and token != "-C":
            i += 1
            continue
        if token.startswith("-c") and token != "-c":
            i += 1
            continue
        if token == "--":
            i += 1
            break
        if token.startswith("-"):
            i += 1
            continue
        break
    if i >= len(args):
        return None, []
    return args[i], args[i + 1 :]


def check_git(args: list[str]) -> None:
    sub, rest = git_subcommand(args)
    if sub is None:
        return
    # Scan every token, not only the ones after the subcommand, so a leading
    # `git --force push` is still a force-push.
    if "--no-verify" in args:
        deny("git --no-verify is blocked")
    if sub == "commit":
        for token in rest:
            if token == "-n" or "n" in short_cluster(token):
                deny("git commit --no-verify is blocked")
    if sub == "push":
        for token in args:
            if token in ("--force", "--force-with-lease", "-f", "--delete", "-d"):
                deny("force-push or remote delete is blocked")
            if token.startswith("--force=") or token.startswith("--force-with-lease="):
                deny("force-push or remote delete is blocked")
            if token.startswith("+") and not token.startswith("++"):
                deny("force-push or remote delete is blocked")
            cluster = short_cluster(token)
            if "f" in cluster or "d" in cluster:
                deny("force-push or remote delete is blocked")
    if sub == "reset" and "--hard" in args:
        deny("git reset --hard is blocked")
    if sub == "clean":
        for token in args:
            if token in ("--force", "-f") or token.startswith("--force="):
                deny("git clean --force is blocked")
            if "f" in short_cluster(token):
                deny("git clean --force is blocked")
    if sub == "add":
        for token in args:
            if token in ("--force", "-f") or token.startswith("--force="):
                deny("git add --force is blocked")
            if "f" in short_cluster(token):
                deny("git add --force is blocked")
        for token in rest:
            if token.startswith("-"):
                continue
            if is_env_basename(token):
                deny("staging an env file is blocked")


def check_node(args: list[str]) -> None:
    eval_flags = {"-e", "-p", "--eval", "--print"}
    if not any(token in eval_flags for token in args):
        return
    blob = " ".join(args)
    markers = (
        "child_process",
        "process.env",
        "readFile",
        "readFileSync",
        "fs.",
        "exec(",
        "spawn(",
        "unlink",
        ".env",
    )
    for marker in markers:
        if marker in blob:
            deny("node -p/-e that reads secrets or runs a command is blocked")


def check_tokens(tokens: list[str]) -> None:
    tokens = strip_wrappers(tokens)
    if not tokens:
        return
    name = program_name(tokens[0])
    args = tokens[1:]
    if name == "rm":
        check_rm(args)
    elif name == "git":
        check_git(args)
    elif name in ("node", "nodejs"):
        check_node(args)
    elif name in SHELLS:
        i = 0
        while i < len(args):
            token = args[i]
            cluster = short_cluster(token)
            if token == "-c" or ("c" in cluster):
                if i + 1 < len(args):
                    check_command(args[i + 1])
                return
            if token == "--":
                break
            if token.startswith("-"):
                i += 1
                continue
            break
    elif name == "eval":
        check_command(" ".join(args))


def check_command(command: str) -> None:
    if not command or not command.strip():
        return
    for inner in substitutions(command):
        check_command(inner)
    for segment in split_segments(command):
        tokens = tokenize(segment)
        if tokens is None:
            # Unbalanced quotes: still catch the obvious destructive text.
            if "rm -rf" in segment or "rm -fr" in segment or "--force" in segment:
                deny("could not parse a command that looks destructive")
            continue
        check_tokens(tokens)


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        return
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return
    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command")
    if not isinstance(command, str):
        return
    check_command(command)


if __name__ == "__main__":
    main()
