---
name: "boilerlift:commit"
description: "Splits the current changes into a few Conventional Commits, one per broad area of the coding session. Use when the user invokes /boilerlift:commit or asks to commit changes."
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*)
---

Commit the current changes, grouped into the broad areas of the coding session. Use exactly two Bash calls.

## 1. Inspect (one call)

```bash
git status --short && git diff --stat HEAD && git log --oneline -8
```

Group from what this session changed, using the stat output. Never read the full diff. Run `git diff -- <file>` only for a file whose area is unclear. Leave out secrets and unrelated untracked files.

## 2. Commit (one call)

Chain every commit in a single command, dependencies first, then confirm:

```bash
git add a b && git commit -m "feat(x): ..." && git add c && git commit -m "docs: ..." && git log --oneline -2
```

When one file spans two areas, keep it with the area it mainly serves.

## Message

- Conventional Commits `<type>(<scope>): <description>`, matching recent log style
- Types: feat, fix, docs, refactor, perf, test, build, ci, chore, revert
- Scope = area touched; omit if obvious
- One short English line, imperative, lowercase after the colon, no period, no body

Do not push. Do not amend. Reply with the commit list only.
