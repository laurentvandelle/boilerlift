---
name: "boilerlift:commit-push"
description: "Commits the current changes with boilerlift:commit (a few Conventional Commits, one per broad area), then pushes the current branch straight to its remote, master or main included, with no pull request. Sets the upstream on a new branch, and when the remote moved (a forgotten pull) rebases the new commits on top instead of making a merge commit. Use when the user invokes /boilerlift:commit-push, or asks to commit and push, commit then push, push my work, ship it, or send the changes to master. To commit without pushing, use /boilerlift:commit. To open a pull request, use /boilerlift:ship."
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/push.py*)
---

Commit what this session changed, then push it to the branch's remote. The user works alone on these repos and wants the work on the remote in one command, directly on the current branch: master or main as much as a feature branch. Invoking `/boilerlift:commit-push` is the go-ahead for both the commits and the push, so ask nothing before pushing. When the branch is protected or the work needs review, the pull request skills fit instead.

The push step is fixed: run the script and handle its exit code as below. The commit grouping (from `boilerlift:commit`) and the wording of the reply are yours.

## Forgotten pull

The user often commits on master without pulling first. A plain `git pull` then makes a merge commit, or a conflict mixes their commits with the remote's. The script avoids both: it fetches, and when the remote is ahead it replays the new commits on top of it (`git pull --rebase --autostash`), so history stays linear. On a conflict it aborts the rebase, so the local commits are back exactly as made and nothing is pushed. Report that and stop: the user resolves it, because choosing between their lines and the remote's is their call.

## 1. Commit

Run the `boilerlift:commit` skill and follow it fully: its grouping, its message rules, its two Bash calls. In Claude Code invoke `/boilerlift:commit`. If it does not load, read `../boilerlift:commit/SKILL.md` beside this skill's directory and follow it.

Its "Do not push" and "Reply with the commit list only" cover the commit step only. Keep the commit list and continue to step 2 in the same response.

When `git status` shows nothing to commit, skip the commits and continue: commits already made but not pushed still go out.

## 2. Push

Run from the repository root, where `<skill-dir>` is this skill's directory:

```bash
python3 <skill-dir>/scripts/push.py
```

The script pushes the current branch to its upstream, or to `origin/[branch]` with `-u` when it has none. On a non-fast-forward rejection it rebases once and pushes once more. It never forces and never passes `--no-verify`, because overwriting the remote or skipping hooks is not what the user approved. `--dry-run` fetches and lists what would go out without pushing.

Stdout is one JSON object: `status` (`pushed`, `up_to_date`, or `dry_run`), `branch`, `remote`, `remote_branch`, `upstream_set`, `rebased`, `commits` (one line each, at most 20; `more_commits` is true past that), `warnings`.

A non-zero exit prints one `error:` line. Stop, report it, and leave the repository as the script left it. Do not retry or fix it by hand, because each way out (force, merge, resolving conflicts) changes history or the remote in a way the user has not chosen.

| Exit | Meaning | Tell the user |
|------|---------|---------------|
| 2 | Not a git repository, or git missing | The line |
| 3 | Detached HEAD, a rebase or merge in progress, or no `origin` | The line, and that the commits are local |
| 4 | Fetch or pull failed | Network or auth problem; commits are local |
| 5 | Push rejected (protected branch, hook, auth) | The line; for a protected branch, suggest `/boilerlift:ship` |
| 6 | Rebase conflict, rebase aborted | The `conflicts` files from the JSON; local commits unchanged, nothing pushed |

## Reply

Short. Add `upstream set` when `upstream_set` is true, `rebased onto the remote first` when `rebased` is true, `and more` when `more_commits` is true, and each warning as is. Drop the `Committed:` block when step 1 made no commits. On `up_to_date` with nothing committed, say there was nothing to commit or push.

Pushed after a forgotten pull:

```text
Committed:
- 3f2a9c1 feat(commit-push): add push script
- 8b07d44 docs: describe the push skill
Pushed master to origin/master (2 commits), rebased onto the remote first
```

Conflict:

```text
Committed:
- 3f2a9c1 fix(api): handle empty payload
Not pushed: master conflicts with origin/master in src/api.ts. The rebase was aborted, your commit is unchanged. Pull and resolve, then run /boilerlift:commit-push again.
```
