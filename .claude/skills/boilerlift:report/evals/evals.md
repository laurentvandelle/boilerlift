# boilerlift:report evals

Run each prompt in a fresh session in a scratch clone of boilerlift with a GitHub remote and an open pull request whose body has a `## Decisions` section. Re-run after any edit to `SKILL.md` or `links.py`, or a model change. Each case names the baseline: what `boilerlift:qa`, the skill this one replaced, did. The helper's own checks, by hand only: `python3 .claude/skills/boilerlift:report/scripts/test_links.py`.

## 1. First push

Prompt: `/boilerlift:report <pr url>, post it as a pull request comment`, with caller assumptions `the flag is named --diff`, on a pull request that adds a module and changes two files.

- `gh pr view` reads `headRefOid`, and `gh pr diff` (not `git diff`) reads the whole pull request.
- The comment starts with `# Report` and has, in order: `## What was done` (1 to 5 one-line bullets), `## Diagram`, `## Where to look`, `## Assumptions`, `## QA`. Nothing before the title.
- The diagram is one mermaid block that marks the new module as new and the two files as changed, with a legend line.
- Where to look has at most 5 bullets, the riskiest first (core logic, state changes, error paths before wiring). Every URL comes from `links.py`, contains `/files/<headRefOid>#diff-` and opens the named line.
- Assumptions lists `the flag is named --diff`, then each item of the body's `### Open assumptions`, without duplicates.
- QA holds at most three scenarios in the `Steps:` / `Expected:` format, UI strings verbatim.
- One new comment is posted with `gh pr comment --body-file`, and the same report is printed in the chat.

Baseline: qa posted a `# QA` comment with the scenarios only.

## 2. Fix that touches no scenario

Prompt: as `/boilerlift:implement-plan-local` step 5 of the fix loop: range `<before>..<after>`, fix description `rename an internal helper`, post requested.

- `git diff <before>..<after>` is read; nothing from commits before `<before>` appears in any section.
- The title is `# Report — fix: rename an internal helper`.
- Where to look links use `<after>` as the SHA.
- The QA section is exactly `No scenario is affected by this fix.`
- A new comment is posted; the first report comment is not edited.

Baseline: qa posted `# QA` then `No scenario is affected by this fix.`, with no other section.

## 3. One-file wording change

Prompt: `/boilerlift:report <pr url>` on a pull request that only changes a message string in one existing file.

- `## Diagram` is one line saying no diagram is needed because the change stays in one file and adds no new part; there is no mermaid block.
- Where to look has one or two links, not five.
- With no caller assumptions and no `### Open assumptions` in the body, Assumptions is `None`.
- Nothing is posted, because no post was asked.

Baseline: qa printed the scenarios only, with no diagram decision.

## 4. Post failure

Prompt: as case 1, with `gh pr comment` failing (a closed pull request, or `gh` logged out).

- The full report and the `gh` error line are printed in the chat.
- The skill ends normally: no retry, no stop of the caller.
- Run through `/boilerlift:implement-plan-local`, the Merge or fix question is asked anyway.

Baseline: qa had no rule for a failed post.

## Trigger queries

Should trigger: "write the review report for PR 31", "write QA scenarios for PR 31", "give me a QA checklist for this pull request", "/boilerlift:report <url>".
Should not: "review this branch against the standards" (code review), "ship #14" (boilerlift:ship), "merge PR 31" (boilerlift:implement-plan-local), "write a backlog card" (boilerlift:create-backlog-card).
