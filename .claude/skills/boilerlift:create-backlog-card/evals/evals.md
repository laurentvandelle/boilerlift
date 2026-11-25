# Test prompts for boilerlift:create-backlog-card

Re-run after each edit of the skill or a model change, in a fresh session. Use `--dry-run` on `backlog.py create`/`update` unless the run is meant to create real issues.

## 1. Free-text story
Prompt: "lift deploy should tell me what changed before pushing, like a diff"
- Type announced as story, with a reason, without asking for confirmation.
- Interview questions are product-level (output, flags, edge cases), none asks for a fact the code map answers.
- One card in the split table, then a stop until approval.
- Card body follows the story template exactly, 3 to 5 Given/When/Then criteria, Open questions None, no src/ path.

## 2. Existing card
Prompt: "refine #[N] for the backlog" (an issue in project 3 with `Card type` set and a vague body)
- `backlog.py read` runs and its JSON is saved to the scratch folder before any write.
- Split card 1 is the card itself; `update --issue N` is used, not `create`.
- Status kept if already set.

## 2b. External issue split in two
Prompt: "turn #[N] into cards" (an issue opened by someone else through the bug form, in `Backlog`, no `Card type`, mixing a crash and a feature wish)
- The issue's title and body are never edited: no `update` on it.
- Each card is created with `create --parent N`, then `triage --issue N --cards a,b` runs once.
- The report links the parent and both cards.

## 2d. Split with a dependency
Prompt: "we need a spike on whether n8n exposes workflow versions, then lift diff built on it"
- The split has two rows: an investigation at order 1, then a story whose `Depends on` is `1`.
- After both `create` calls, `block --issue [story] --blocked-by [investigation]` runs once; no `block` call goes the other way.
- The report shows the story as blocked by the investigation.

## 2c. Duplicate
Prompt: "triage #[N]" (an untriaged issue asking for something an open card already covers)
- The split shows a single `No card` row with the duplicate's URL, then stops for approval.
- On approval, `close --issue N --reason duplicate --duplicate-of M` runs; no card is created.

## 3. Edge case: bug + feature in one sentence, reporter knows little
Prompt: "lift deploy crashes when one of my workflows has no tags, and also it would be nice if status showed the last deploy date" (answer "Don't know" to every fact)
- Two subjects found in step 3, each with its own type; interview rounds never mix the two.
- Fact questions (version, output) carry no recommended option and offer Don't know.
- If the code shows tagless workflows are handled, the skill raises "investigation instead of bug".
- The bug card keeps `unknown` values and is still created; the report lists the unknowns.

## 4. Unattended
Same as 1, with no one answering.
- Nothing is created; drafted split and cards are written to the scratch folder and their paths reported.

## Trigger queries
Should trigger: "add a backlog card for X", "write a user story for the status command", "open a bug ticket: deploy fails on n8n 1.40", "turn #14 into a proper card", "we need a spike on n8n webhooks", "create issues for this feature: [notes]".
Should not: "ship #14" (boilerlift:ship), "interview me about this plan" (boilerlift:interviewing), "write QA scenarios for PR 31" (boilerlift:report), "fix issue #14" (coding), "release v0.3.0" (release).
