# boilerlift:ship evals

Run each prompt in a fresh auto-mode session in a scratch clone of boilerlift with a GitHub remote (or the fake `gh` from `scripts/test_create_pr.py`). Re-run after any edit to `SKILL.md` or `create_pr.py`. Each case names the baseline: what the previous version of the skill did. The script's own checks, by hand only: `python3 .claude/skills/boilerlift:ship/scripts/test_create_pr.py`.

## 1. Normal card

Prompt: `/boilerlift:ship #<n>`, on a `story` card of project 3 with a clear spec.

- An Explore subagent maps the code before round 1; its summary, not raw files, is in the main thread.
- No branch, push, pull request or project write happens before the Ship click.
- `create_pr.py` is called once, with `--type --id --name`, never `--branch`.
- The PR body starts with `Closes #<n>`, keeps the template headings in order (empty ones dropped) and contains no `{{BRANCH}}`.
- `backlog.py status --status "In progress" --only-from "Inbox,Backlog,Ready"` runs right after `create_pr.py` and before `start_session`; the card ends `In progress` with the pull request in its linked pull requests; the session runs `/boilerlift:implement-plan-local <pr url>` in auto.
- The reply follows the reply format, in order, omitting empty lines.

Baseline: the old version read the code in the main thread before round 1.

## 1b. Debug setup and Test line

Prompt: as case 1, then as case 3's resume.

- `npm run debug:setup` runs in the worktree right after `create_pr.py` exits 0 and before `backlog.py status`, on the new pull request and on the resume.
- After it, `debug/boilerlift.lock.json` in the worktree is a symlink to the main checkout's file; when the main checkout had none, it now holds `{"version":1,"instances":{}}` (pretty-printed).
- No `lift` command and no `npm start` runs; `debug/.env` is reported by path only.
- The reply ends with `Test: cd <worktree> && npm start -- <cmd>`, with the absolute worktree path.

Baseline: the generic ship flow left `debug/` uninstalled and gave no `Test:` line.

## 2. Messy title

Prompt: `/boilerlift:ship #<n>` — `bug` card titled `Écran « Paiement » cassé quand l'utilisateur a 2 cartes, et qu'il revient en arrière depuis l'étape 3`; its body asks for the message `Votre carte a été mise à jour` after the fix.

- Branch starts with `fix/`, is lowercase ASCII, has no `,` `'` `«`, and its slug is 50 characters or fewer.
- The UI copy section has `Votre carte a été mise à jour` verbatim.

Baseline: the old formula kept commas and apostrophes and had no length cap (seen: `…-n8n-id,-recorded-in-my-project`).

## 3. Re-run after a failed launch (edge case)

Setup: run case 1, then make `start_session` refuse (run from a default-mode session). Then run `/boilerlift:ship` on the same card again from an auto-mode session.

- First run: prints the hand-start prompt and worktree, points to `README.md`, deletes nothing.
- Step 1 finds the open pull request in `open_prs` and offers `Resume (Recommended)`; on Resume there is no interview.
- Second run: `create_pr.py --branch <head branch> --resume` exits 0 with `resumed: true`, the same `pr_url`, no new commit; the reply says `(resumed)`.
- Status is not moved back if the card was already `In review` (`backlog.py status` reports `skipped`).
- No agent-made `git worktree add`, `git push` or `gh pr create` outside the script.

Baseline: the old version stopped on exit 4 and left the user to clean up by hand.

## 4. Ship after a background subagent

Prompt: `/boilerlift:ship #<n>` on a `story` card, with the Explore subagent of step 2 running in the background.

- Ship is asked through `wrap_up` buttons `Ship` / `One more round`, not `AskUserQuestion`.
- After the `Ship` click, `start_session` starts the coding session in that same turn; there is no "Start the coding session now?" question.

Baseline: the old version asked Ship with `AskUserQuestion` inside the turn the subagent's notification began; the app refused `start_session` and Claude asked the user a second time.

## 5. Issue that is not a card (edge case)

Prompt: `/boilerlift:ship #<n>` on an untriaged issue (in `Inbox`, no `Card type`).

- Stops in step 1, points to `/boilerlift:create-backlog-card #<n>`, asks no interview question, calls no `create_pr.py`.

## 6. Investigation card

Prompt: `/boilerlift:ship #<n>` on an `investigation` card.

- The branch starts with `spike/<n>-`.
