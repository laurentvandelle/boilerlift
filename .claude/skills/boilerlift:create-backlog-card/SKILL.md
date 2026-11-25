---
name: "boilerlift:create-backlog-card"
description: "Turns a free-text request or an existing GitHub issue into ready-to-code boilerlift backlog cards (story, tech story, bug or investigation) in GitHub project 3 (laurentvandelle/projects/3). Deduces the card type, runs a product interview grounded in the code, proposes a split into cards and waits for approval, writes each card from its strict template, checks it against a Definition of Ready, then creates the issues in laurentvandelle/boilerlift with Card type set and Status Ready: as sub-issues of an untriaged input issue, which stays untouched, or as a rewrite of an issue that is already a card. Use when the user invokes /boilerlift:create-backlog-card, or asks to create, write, add or refine a backlog card, ticket, issue, user story, bug report or spike for boilerlift, even if they only describe an idea, paste notes or give an issue number. To take a ready card to a pull request, use /boilerlift:ship; to stress-test a plan with no card to create, use /boilerlift:interviewing."
allowed-tools: "Bash(${CLAUDE_SKILL_DIR}/scripts/backlog.py *)"
---

# Create a backlog card

Turn a request into one or more boilerlift backlog cards that a developer or a coding agent can start without asking anything. A card says what and why, never how: the solution belongs to the plan made later with `/boilerlift:ship`. The run ends with issues in `laurentvandelle/boilerlift`, each in project 3 with `Card type` set and `Status` = `Ready`, because every card has passed the Definition of Ready.

## Terms

- **Untriaged issue**: any issue with no `Card type`: an idea from `/boilerlift:inbox` or an issue someone opened through a form. Project 3's automations put every new issue in the `Backlog` column; a missing `Card type` is the only "not triaged yet" marker, since `Backlog` also holds cards that are not ready yet.
- **Card**: an issue with `Card type` set, written from a template in [card-templates.md](card-templates.md).
- **Parent**: an untriaged issue once it is triaged. Its title and body stay as its author wrote them; its cards are its sub-issues, it gets a comment listing them, and its board item is archived. A GitHub Action closes it when its last card closes.

Rules for the whole run:

- **Everything is in English**: questions, previews, cards, because the repository, its issues and the coding agents that read them work in English.
- **The split approval is the only go-ahead.** Nothing is created or edited on GitHub before the user explicitly approves the split, because issues are visible to others. After that, create the cards without asking again, then offer adjustments.
- **`scripts/backlog.py` owns every GitHub call.** On a non-zero exit, report its `error:` line and stop: hand-written `gh` calls skip its duplicate and field checks.
- **An untriaged issue is never edited.** Its author's words are the record of what they asked: its cards are new sub-issues. Only an issue that is already a card is rewritten in place.
- **A card carries only its body, its title, `Card type`, `Status` and its "blocked by" links.** Estimates, assignees and links to other tools are decided when someone picks the card up, not at creation.
- **Facts come from the user or the code.** A coding agent takes every line of a card as true, so an unknown value stays `unknown` (rules in [card-templates.md](card-templates.md)), and any other gap becomes a question.
- **With no one to answer** (an unattended run), go through step 4 and stop: write the drafted split and cards to the scratch folder, report their paths and the open questions, and create nothing, because a card built on guesses costs more than a late one.

Read [card-templates.md](card-templates.md) before step 3: it holds the type rule, the four templates and the Definition of Ready.

## Workflow

### 1. Read the input and the project

Run `${CLAUDE_SKILL_DIR}/scripts/backlog.py context`. Exit 3 (missing `project` scope): tell the user to run `gh auth refresh -s project` and stop. Exit 4 with no `Card type` field: ask whether to create it (`Create field (Recommended)` / `Stop`), stop and wait, and on yes run `backlog.py setup-type-field`, then `context` again. Exit 4 with no `Ready` status, or a `Card type` field missing one of the four options: tell the user to add that option in the project settings, and stop.

The input is one of:
- **An untriaged issue** (number, `#12` or URL whose `read` shows no `project_item.type`): run `backlog.py read --issue N`. Its title and body are the request; it becomes the parent of the cards. Its `author` says who to write for: someone other than `laurentvandelle` is an external reporter, so facts only they hold stay `unknown` unless the issue states them.
- **An existing card** (`read` shows a `project_item.type`): its body is the request, and it is refined in place. Save that JSON to the scratch folder: the copy is the only way back if a write fails halfway.
- **Free text**: the request is the user's words. The cards are created with no parent.

`read` exit 4: the issue does not exist; say so and stop.

List what the request already settles, so the interview never asks it again. Done when: the project check passed and the request is known.

### 2. Map the code (subagent)

Have an `Explore` subagent read the code the request touches, so the interview asks only what the code can't answer. Brief it with the request text and the repository root, and ask for, under 30 lines:

```text
Current behaviour: what boilerlift does today in this area (commands, flags, output, errors)
Already specified: docs, README, tests or GLOSSARY.md lines that define the expected behaviour
Related cards: open issues in laurentvandelle/boilerlift on the same topic (gh issue list --search)
Facts the code does not settle: one line each
```

Without subagents, read the code yourself and keep only those notes. Use them to ask better questions and to spot a bug (expected behaviour already specified) versus a story. Never copy file paths or a solution into a card. Continue in the same response.

### 3. Find the subjects and their types

List the independent subjects in the request first: a malfunction and a change request are two subjects even in one sentence. For each, apply the type rule in [card-templates.md](card-templates.md) and announce the type and its reason in one or two lines, without asking for confirmation. Continue in the same response.

When the user reports a bug but the code map shows the case is handled and tested, say so: the card may be an investigation ("Reproduce [symptom]", with a timebox) rather than a bug. Put that choice to the user in the first interview round.

### 4. Interview

Run a product interview with the `boilerlift:interviewing` method: a design tree, the frontier in rounds of at most 4 multiple-choice questions with AskUserQuestion, the recommended option first, in English. Stop and wait after each round. Ask only what the request and the code map don't already answer. With several subjects, finish one subject's questions before the next, so a round never mixes cards.

Decisions (scope, rules, output format) get a recommended option. Facts only the user holds (version, error output, frequency) get none, because a recommended fact is an invented one: offer plausible values plus `Don't know`.

Cover the fields of the type:
- **story**: which user (a workflow author running `lift`, a CI pipeline, a library user), the value, what is included and excluded, the rules (validation, flags, exit codes, error messages).
- **tech story**: the current situation and the cost of leaving it, the target behaviour, what is touched and explicitly untouched, what must not break.
- **bug**: version or branch, where it ran (local or CI), OS and Node version, n8n version and API key role, frequency, severity, exact reproduction steps, expected result, actual result, evidence (command output, stack trace).
- **investigation**: the single closed question, what is blocked until it is answered, the timebox, the options, the evaluation criteria.

Dig acceptance criteria during the interview, not after: for each expected behaviour, settle the context, the action and the observable result, plus at least one edge case (error, missing input, n8n unreachable). A criterion that no test or observation could check is reworded with the user.

Done when the frontier is empty and every section of the template can be filled. Close the interview with a decision summary per subject (type, user, scope in and out, rules, criteria, unknowns), and write steps 5 and 6 from that summary, not from the whole conversation.

### 5. Propose the split

List the independent subjects and split by deliverable value, not by technical layer:
- one card = one goal, checked by one set of acceptance criteria;
- a malfunction and a change request never share a card, nor do a user need and its technical debt;
- a blocking technical unknown becomes its own investigation card, ordered before the cards it unblocks;
- one subject gives "one card", with the reason: never split artificially.

Show this table, then the split logic in one line:

| Order | Title | Type | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 1 | [title] | [story / tech story / bug / investigation] | [what the card covers] | [card or none] |

**Depends on** names the cards that must ship first: another row of the split by its order (`1`), or an open issue in `laurentvandelle/boilerlift` (`#42`) that the code map or the interview showed this card needs. Each entry becomes a "blocked by" link in step 8, so leave it at `none` for a card that only relates to another without waiting on it.

For an untriaged issue, every row is a new sub-issue of it; for an existing card, card 1 is that card (rewritten) and the others are new issues.

When triage finds that the issue needs no card (a duplicate of an open issue, out of the backlog's scope, or a question that an answer settles), show a single row `No card` with the reason instead, and the duplicate's URL if any. Approving it closes the issue in step 8.

Ask with AskUserQuestion: `Approve split (Recommended)` / `Change it`. Stop and wait. On a change, apply it, show the revised table and ask again.

### 6. Write each card

For each card, fill its type's template from [card-templates.md](card-templates.md), section by section, in order, into a scratch file (one per card). Title: an action verb and an object, short, plain ASCII with no punctuation, because a branch name is derived from it (`Add lift diff command`, `Fix deploy crash on untagged workflow`).

In chat, preview only each card's title, type and acceptance criteria, not the full body. Continue in the same response.

### 7. Check the Definition of Ready (subagent)

Have a fresh subagent check each card file against the Definition of Ready in [card-templates.md](card-templates.md), because an agent rereads its own draft poorly. Give it only the card files and that file's path, and ask for one line per check: `PASS` or `FAIL: [what is missing]`. Without subagents, run the checklist yourself, line by line.

On a `FAIL` caused by missing information, go back to step 4 with a targeted round on that point only, once. If the user still doesn't know, the value stays `unknown` and the card goes ahead: a bug report with honest gaps is still worth tracking. On a wording `FAIL`, fix the card and re-check. A card that still fails waits, with its reason; the ready cards of the split go ahead.

### 8. Create the cards and report

For each card, in split order:
- input was an untriaged issue: `backlog.py create --parent N --type "[type]" --title "[title]" --body-file [file]`
- input was free text: `backlog.py create --type "[type]" --title "[title]" --body-file [file]`
- the existing card itself: `backlog.py update --issue N --type "[type]" --title "[title]" --body-file [file]` (keeps its Status, sets Ready when it is empty or `Backlog`)

Once every card of an untriaged issue exists, run `backlog.py triage --issue N --cards [numbers, comma-separated]`: it comments the cards on the parent and archives the parent's board item, so the board shows only cards. Skip it when no card was created.

Once every card exists, link the dependencies: for each card whose **Depends on** is not `none`, run `backlog.py block --issue [card] --blocked-by [numbers, comma-separated]`, with split rows turned into the issue numbers just created. One direction is enough: GitHub shows the blocking side on the other issue. A dependency on a card that waits (failed the Definition of Ready) is not linked; report it instead. A link that fails leaves the cards as they are: report its `rerun with:` command, never recreate a card.

An approved `No card` row: write the one-line reason to a scratch file and run `backlog.py close --issue N --reason "not planned" --comment-file [file]`, or `--reason duplicate --duplicate-of M` for a duplicate.

An exit 6 after the issue was created names its URL and the command that finishes it (`update --issue M`, then `link --parent N --issue M` when the sub-issue link failed): run that, never a second `create`. Exit 5 means an open issue already has that title: show its URL and ask whether to rewrite that one instead or rename the card. Stop and wait.

Then report, per card: the issue link and title, the type, the issues it is blocked by, and any `-> owner:` question left, plus the parent's link when there is one. Ask whether to adjust anything now that the cards exist.

## Gotchas

- The code map is for questions, not content. A card that names `src/core/deploy.ts` or "add a flag in `cli/deploy.ts`" has turned into a plan: describe the behaviour the user sees instead. What the user touches is fine to name: commands, flags, `--json` fields, exit codes, files they edit such as `boilerlift.config.ts`.
- Then report, per card, every `unknown` left in it, so the reporter can fill it in on the issue.
- "lift deploy doesn't do X" is a bug only if X is specified somewhere (README, docs, a test, a past card). Otherwise it is a story, even when the user says "bug".
- A story's `Open questions` is `None` at creation. If a question is still open, the interview is not finished.
- `gh project` needs the `project` token scope, which `repo` does not include.
- The project field is `Card type`, not `Type`: GitHub reserves `Type` for its own issue types and refuses to create a field with that name.
- The issue body starts with the template's `#` heading (`# 📗 Story`); the card name goes in the issue title only.

## Example

Input: "lift deploy should tell me what changed before pushing, like a diff"

Type: story. A workflow author wants a new capability; nothing in the README specifies a diff today.

After the interview, the split is one card, `Show workflow diff before deploy`, story, with acceptance criteria such as:
- Given a workflow changed locally, when I run `lift deploy --dry-run`, then each changed workflow lists its added, removed and modified nodes.
- Given no workflow changed, when I run `lift deploy --dry-run`, then the output says nothing would change and the exit code is 0.
- Given n8n is unreachable, when I run `lift deploy --dry-run`, then the command fails with the instance URL in the error and a non-zero exit code.

## Edge cases

- **Several unrelated subjects in one sentence**: split them in step 5, one card each.
- **Issue already well written**: still run steps 2 to 7; if nothing is missing, the interview is one round confirming the criteria.
- **Idea from `/boilerlift:inbox`**: its body is the user's idea cleaned up as English bullet points; it is an untriaged issue like any other and becomes the parent.
- **External issue** (author other than `laurentvandelle`, usually from the bug or feature form): the form's sections are the request; never edit its text, and ask the user, not the reporter, during the interview. The parent's comment from `triage` is how the reporter learns what became of it.
- **Issue that already has sub-issues**: it was triaged before; say so and ask whether to add cards to it or stop.
- **Issue closed, or not in project 3**: say so; a closed issue is used only if the user confirms, and `create`/`update` add missing issues to the project.
- **Request about n8n itself, not boilerlift**: say it is out of the backlog's scope and stop.
- **Huge request (a whole feature area)**: propose the split first, then interview card by card, so each round stays short.
