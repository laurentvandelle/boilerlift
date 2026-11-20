---
name: "boilerlift:qa"
description: Writes the three critical human-testable QA scenarios for a GitHub pull request, from its decision summary (or step plan) and its diff. Scores each candidate path and keeps the three that best show the feature works, each as numbered steps and an expected result. Can limit the output to the scenarios a given fix touches, and can post the result as a pull request comment when asked. Does not execute them. Use when the user invokes /boilerlift:qa with a pull request URL, asks for a QA checklist or test scenarios for a PR, or when /boilerlift:implement-plan-local (launched by /boilerlift:ship) needs the scenarios after its push or after a fix.
---

Write the three critical QA scenarios for one GitHub pull request. Do not execute them.

A scenario is a path a person runs in the product. A failed run shows the feature is wrong. The user runs these by hand before merging, so three sharp paths beat a long list.

Print the scenarios in the chat. Post them on GitHub only when the caller asks (see [Posting](#posting)): by default the user decides whether they are shared.

## Input

- A GitHub pull request URL, or a pull request body already read by `/boilerlift:implement-plan-local` together with its URL.
- Optional: a **fix description**. The caller passes it after a fix to ask for only the scenarios affected by this fix.
- Optional: a request to **post as a pull request comment**.

The source of truth is the pull request body. It holds either a decision summary under `## Decisions` (written by `/boilerlift:ship`) or a step plan. Accept both. With only a URL:

```bash
gh pr view <url> --json title,number,body,url
```

No URL: stop and say a GitHub pull request URL is required.

The body has neither a `## Decisions` section nor steps: stop and say there is nothing to test against.

Read the changes with `gh pr diff`, not `git diff`: the local base may be stale, and the pull request diff is what will merge.

```bash
gh pr diff <url>
```

When `/boilerlift:implement-plan-local` called this skill, read the diff after its push, so it includes the commits just made.

## Candidates

Write one candidate per distinct outcome the body and the diff both support. With a decision summary, each decision that changes what a person sees or can do is a source of outcomes. Include the success path and a failure a person would actually hit.

Skip a behavior the body does not describe. Skip a behavior the diff does not change. Skip a minor variant that confirms the same result again.

Human-testable means a person can set up the state, perform the steps, and see whether the expected result holds. Reading code, logs, GitHub, or a workflow is not a candidate. Opening the pull request, the branch, the review comment, and the commits are not candidates. Do not add a candidate whose only step is running the verify command.

Setup is product state the person puts in place first, such as a screen, a record, or an account. It is not a fact about the repository.

Copy UI strings from the body verbatim, including punctuation and language.

## Score

Score every candidate. Do not print the scores or the candidates you drop. Each criterion is 0, 1, or 2.

- **Breaks the feature.** 2 if a failed run means the feature does not do what the body promises. 1 if a failed run means one required fact is wrong and the main path can still pass. 0 if the failure is cosmetic or repeats a result already scored.
- **A person hits it.** 2 if normal use of the feature reaches this path. 1 if a person reaches it only when a state the body names is present. 0 if a person cannot reach it in the product.
- **Stands alone.** 2 if its setup and its expected result differ from every higher-scored candidate. 1 if it shares a setup and checks a different result. 0 if it confirms the same result again.

Add the three numbers. Keep the three highest totals. A tie goes to the path a person hits first in normal use. Drop a candidate that scores 0 on **A person hits it**.

Fewer than three candidates remain: write only those. None remain: stop and say there is nothing to test.

## Only the scenarios affected by a fix

When the caller passes a fix description, score as above, then keep only the kept scenarios whose steps or expected result the fix touches: the fix changes a screen, string, state, or rule that the scenario uses or checks. Add a candidate the fix itself introduces if it scores into the top three. The result may be one or two scenarios.

No scenario is touched: print `# QA` then `No scenario is affected by this fix.` and stop.

## Output

Use exactly this format, so every pull request gets the same scenarios. Start with this title. Nothing else in the header. No pull request title. No URL.

```markdown
# QA
```

Then the scenarios, highest score first.

```markdown
### <short English name>
Steps:
1. <setup: put the product in the starting state>
2. <next step the tester does>
3. <next step>

Expected: <one or two lines of observable facts>
```

- Steps are a numbered list. Step 1 is the setup. Each step is one imperative English sentence.
- Expected is one or two lines of observable facts from the body: visible copy, a cleared field, a status, a record present or absent. UI strings verbatim.
- No precondition block. No checkboxes.

## Posting

Only when the caller asks. Post the exact output as one comment, then print it in the chat as well:

```bash
gh pr comment <url> --body-file <file>
```

Write the output to a temporary file first, so the Markdown is not mangled by the shell.

## Example

```markdown
# QA

### Forget the server
Steps:
1. Register a server in the app.
2. Open Server and tap **Forgot server**.
3. Confirm `Forgot server?`.
4. Return to Home.

Expected: the URL, identifier, password, phone name, and folder are cleared. Home shows `No server`.
```
