---
name: "boilerlift:implement-plan-local"
description: Implements the decision summary in an open GitHub pull request body, in the current checkout on this machine. Plans its own steps from the code, runs the repo's verify command, commits and pushes with boilerlift:commit-push, posts the boilerlift:qa scenarios on the pull request, then asks Merge or fix. On Merge, squash-merges, deletes the branch, removes the worktree, fast-forwards the base branch (main or master) in the main checkout so the next session starts up to date, and the merge closes the card through Closes #N, which the project board moves to Done. Does not create a branch, a worktree, or a pull request. Use when the user invokes /boilerlift:implement-plan-local with a pull request URL, usually as the first prompt of the auto-mode session started by /boilerlift:ship in the kept worktree.
disable-model-invocation: true
allowed-tools: "Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/preflight.py *), Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/finish.py *), Bash(${CLAUDE_SKILL_DIR}/../boilerlift:create-backlog-card/scripts/backlog.py *)"
---

Implement the decisions in one open pull request, in this checkout, get them QA'd by the user, and merge.

`boilerlift:ship` already created the branch, the worktree you are in, and the pull request, and set its backlog card (an issue in GitHub project 3) to `In progress`. The user will run the app here and QA it, so a pushed, verified branch and clear QA scenarios come first, then the merge on their word.

## Input

The prompt names one pull request URL. No URL: stop and say a pull request URL is required.

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/preflight.py <url>
```

It prints one JSON object: `pr` (with `body`), `branch`, `card` (the issue number from the body's `Closes #N` line, or null), `install`, `verify`, and `problems`. Exit 1 means `problems` is not empty: the pull request is not `OPEN` (pushing there goes nowhere useful), or the current branch is not its head branch (the work would land in the wrong place). Stop and report each problem. Exit 2 is one `error:` line: stop and report it. Do not create a branch, a worktree, or a pull request.

`pr.body` is a decision summary, not a step plan:

```markdown
Closes #<card>
Branch name : <branch>

## Decisions
### Goal
### Scope
### Out of scope
### UI copy
### Edge cases & rules
### Open assumptions
```

Scope says what to build. Out of scope is a hard limit. UI copy is exact text: use it verbatim. Edge cases & rules are behaviour to implement and keep. Open assumptions were not confirmed in the interview: follow them and repeat them under **Assumptions** in the final report.

## Implement

Obey the repo's nearest `AGENTS.md` while editing.

A fresh worktree has no dependencies. When `install` is not null, run it first: it uses the lockfile's manager in a mode that leaves the lockfile unchanged, so it cannot end up in the commit.

Read the code the decisions touch, then plan the steps yourself. Keep the plan internal: do not print it or ask for approval. Build everything in Scope and nothing in Out of scope. Do not commit while coding, so the commit step can group the whole change by area.

Nobody is watching this run until the QA question. When a decision is ambiguous, take the most reasonable reading, note it, and continue. List those readings under **Assumptions** in the final report, so the user checks them during QA.

## Verify

Pick the command:

1. `verify` from the preflight JSON, when it is not null.
2. Otherwise the check command the nearest `AGENTS.md` names (test, lint, typecheck).
3. Otherwise say no verify command was found, and continue to Commit.

Run it. Fix failures and run it again. Still failing after a real fix attempt: stop. Name the failing command and the error. Do not commit, push, or run `boilerlift:qa`. Leave the changes uncommitted so the user can see them in the worktree. Then ask the user how to proceed.

## Commit

No changes: stop and say the decisions changed no files. Do not commit.

Commit and push with the `/boilerlift:commit-push` skill. It pushes this pull request branch to its own remote branch, never to the base. Any push failure, including a protected branch: report its `error:` line and stop. The commits stay local. Ignore its `/boilerlift:ship` suggestion, since this branch already has a pull request.

## Card in review

Right after the first push and before QA, move the card to `In review`:

```bash
${CLAUDE_SKILL_DIR}/../boilerlift:create-backlog-card/scripts/backlog.py status --issue <card> --status "In review" --only-from "In progress"
```

`--only-from` makes a re-run after a fix a no-op (`skipped`). No `card` in the preflight JSON, or a non-zero exit: warn and continue, because QA does not depend on it.

## QA

Run the `/boilerlift:qa` skill on this pull request URL, and ask it to post the result as a pull request comment. It reads the body and the diff with `gh` after the push, prints the scenarios in the chat, and posts them with `gh pr comment`. Do not execute the scenarios: the user runs them.

Then ask with AskUserQuestion, header `QA`:

- `Merge (Recommended)`: the scenarios pass.
- `I need to fix`: something is wrong.

### I need to fix

Ask the user to describe the problem, unless they already did in the answer. Then:

1. Fix it, within the decisions.
2. Verify (same rules as above).
3. Commit and push with `/boilerlift:commit-push` (same rules as above).
4. Run `/boilerlift:qa` with this fix description and the post request, so it writes and posts only the scenarios the fix touches.
5. Ask the QA question again.

Repeat until the user picks Merge.

### Merge

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/finish.py <url>
```

Run it from this worktree. It refuses before changing anything when the worktree has uncommitted or untracked files, or commits not pushed (exit 3): commit and push them, then run it again. Otherwise it runs, stopping at the first failure:

1. `merge`: `gh pr merge <url> --squash` from the main checkout (skipped when already merged).
2. `delete_remote`: deletes the remote branch through `gh api` (already deleted is ok).
3. `remove_worktree`: `git worktree remove` without `--force`. This deletes the folder you are in: run later shell commands from the `main` path it prints.
4. `delete_branch`: `git branch -D <branch>` in the main checkout.
5. `fetch`: `git fetch --prune origin` in the main checkout.
6. `update_base`: fast-forwards the pull request's base branch (`main` or `master`) in the main checkout to `origin/<base>`, so the next session started there has the merged change. It never merges or rebases: a diverged local base, or local edits that the update would overwrite, fail this step (exit 9) with everything else done. Report it and leave the main checkout to the user.

It prints JSON with `ok`, `branch`, `base`, `worktree`, `main`, and `steps` (`step`, `ok`, `detail`), and one `error:` line on failure. On failure, report the failed step and its detail, and what the earlier steps already did. Do not retry with `--force` or delete anything by hand. Running it again is safe: it skips a merge already done and a branch already deleted.

When `ok` is true, the merge has closed the card through `Closes #N`, and the board's own rules set it to `Done`: make no status call, because the worktree holding this skill's scripts is gone. No `card` in the preflight JSON: say the pull request closed no card.

## Report

End with the pull request URL, whether it is merged, the commits pushed, the verify command that passed (or "none found"), the card (`#<card>` closed, or none), and **Assumptions** when there are any.
