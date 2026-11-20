# boilerlift:ship evals

Run each prompt in a fresh auto-mode session in a scratch clone of boilerlift with a GitHub remote (or the fake `gh` from `scripts/test_create_pr.py`). Re-run after any edit to `SKILL.md` or `create_pr.py`. Each case names the baseline: what the previous version of the skill did. The script's own checks, by hand only: `python3 .claude/skills/boilerlift:ship/scripts/test_create_pr.py`.

## 1. Normal card

Prompt: `/boilerlift:ship https://app.notion.com/p/<card-id>`, on a `story` card with a clear spec.

- An Explore subagent maps the code before round 1; its summary, not raw files, is in the main thread.
- No branch, push, pull request or Notion write happens before the Ship click.
- `create_pr.py` is called once, with `--type --id --name`, never `--branch`.
- The PR body keeps the template headings in order (empty ones dropped) and contains no `{{BRANCH}}`.
- `notion-update-page` runs with `update_properties` right after `create_pr.py` and before `start_session`; the card ends `In Progress 🔁` with `GitHub PR URL` equal to `pr_url`, and the reply does not ask to paste it by hand; the session runs `/LV:implement-plan-local <pr url>` in auto.
- The reply follows the reply format, in order, omitting empty lines.

Baseline: the old version read the code in the main thread before round 1.

## 1b. Debug setup and Test line

Prompt: as case 1, then as case 3's resume.

- `npm run debug:setup` runs in the worktree right after `create_pr.py` exits 0 and before `notion-update-page`, on the new pull request and on the resume.
- After it, `debug/boilerlift.lock.json` in the worktree is a symlink to the main checkout's file; when the main checkout had none, it now holds `{"version":1,"instances":{}}` (pretty-printed).
- No `lift` command and no `npm start` runs; `debug/.env` is reported by path only.
- The reply ends with `Test: cd <worktree> && npm start -- <cmd>`, with the absolute worktree path.

Baseline: the global `LV:ship` left `debug/` uninstalled and gave no `Test:` line.

## 2. Messy title

Prompt: `/boilerlift:ship https://app.notion.com/p/<card-id>` — `bug` card, `Nom` = `Écran « Paiement » cassé quand l'utilisateur a 2 cartes, et qu'il revient en arrière depuis l'étape 3`; its content asks for the message `Votre carte a été mise à jour` after the fix.

- Branch starts with `fix/`, is lowercase ASCII, has no `,` `'` `«`, and its slug is 50 characters or fewer.
- The UI copy section has `Votre carte a été mise à jour` verbatim.

Baseline: the old formula kept commas and apostrophes and had no length cap (seen: `…-n8n-id,-recorded-in-my-project`).

## 3. Re-run after a failed launch (edge case)

Setup: run case 1, then make `start_session` refuse (run from a default-mode session). Then run `/boilerlift:ship` on the same card again from an auto-mode session.

- First run: prints the hand-start prompt and worktree, points to `README.md`, deletes nothing.
- Step 1 notices `GitHub PR URL` is set and offers `Resume (Recommended)`; on Resume there is no interview.
- Second run: `create_pr.py --branch <head branch> --resume` exits 0 with `resumed: true`, the same `pr_url`, no new commit; the reply says `(resumed)`.
- Status is not moved back if the card was already past `In Progress 🔁`.
- No agent-made `git worktree add`, `git push` or `gh pr create` outside the script.

Baseline: the old version stopped on exit 4 and left the user to clean up by hand.

## 4. Ship after a background subagent

Prompt: `/boilerlift:ship https://app.notion.com/p/<card-id>` on a `story` card, with the Explore subagent of step 2 running in the background.

- Ship is asked through `wrap_up` buttons `Ship` / `One more round`, not `AskUserQuestion`.
- After the `Ship` click, `start_session` starts the coding session in that same turn; there is no "Start the coding session now?" question.

Baseline: the old version asked Ship with `AskUserQuestion` inside the turn the subagent's notification began; the app refused `start_session` and Claude asked the user a second time.

## 5. Card without an ID (edge case)

Prompt: `/boilerlift:ship https://app.notion.com/p/<card-id>` on a card whose `ID` property is empty.

- Stops in step 1, names `ID`, asks no interview question, calls no script.
