# boilerlift:ship

The ship flow for the boilerlift repository. The flow is in `SKILL.md`. Every skill and script it uses lives in `.claude/skills/` (`boilerlift:interviewing`, `boilerlift:domain-modeling`, `boilerlift:plan`, `boilerlift:implement-plan-local`, `boilerlift:commit-push`, `boilerlift:commit`, `boilerlift:qa`), so nothing depends on skills installed outside the repository. It adds one step to the generic ship flow: right after `scripts/create_pr.py`, it runs `npm run debug:setup` in the worktree, so any lift command runs on the latest code of the branch with `npm start -- <cmd>`.

## What is already set up in this repository

- `.claude/settings.json`: the allowlist the coding session (`/boilerlift:implement-plan-local`) runs without a prompt, and the deny rules. Project allow rules apply only after you accept the workspace trust dialog for that folder; `create_pr.py` trusts each new worktree in `~/.claude.json`.
- `.claude/hooks/block-dangerous.py`: the `PreToolUse` hook those deny rules cannot express. It exits 2, which blocks the command even when an allow rule matches: force-push and remote delete with flags in any order, recursive `rm`, `git reset --hard`, `git clean --force`, `--no-verify`, `git add` of a `.env*` path, and `node -p` / `node -e` that reads an env file or spawns a process. It does not print the command.
- `.gitignore` ignores `.env*` except `.env.example`.

These rules are not an OS sandbox. A command that reads `.env` without naming it, or a subprocess the hook does not parse, is outside them.

## Env files

New worktrees do not contain ignored files. `create_pr.py` symlinks the main checkout's untracked `.env*` files (any basename starting with `.env`, at any depth) into the new worktree, `debug/.env` included. It does not overwrite a file that is already there, and it does not print file contents. Symlinks share the file with the main checkout: editing `.env` in the worktree edits the original.

## Debug project

`npm run debug:setup` (`debug/setup.ts`) installs the root dependencies, builds `dist/`, installs `debug/` dependencies, and links the worktree's `debug/boilerlift.lock.json` to the main checkout's copy, creating an empty one there first when it is missing. In the main checkout it leaves the lock file as it is. A lock file that already exists in the worktree and is not that link is left as it is, with a warning. It never runs lift.

## What you do by hand

- Start `/boilerlift:ship` from a session in auto mode (see `SKILL.md`).
- Answer the interview, click Ship, run `cd <worktree> && npm start -- <cmd>` and the QA, then click Merge or I need to fix. On Merge, `boilerlift:implement-plan-local` removes the worktree and fast-forwards `main` in the main checkout, so the next session starts up to date.

## Check

By hand only, not in CI or `npm run verify`:

```bash
python3 .claude/skills/boilerlift:ship/scripts/test_create_pr.py
```

All scripts are Python 3.9+ with the standard library only. Run the prompts in `evals/evals.md` after any edit to `SKILL.md` or `create_pr.py`.
