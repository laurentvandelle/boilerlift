---
name: "boilerlift:plan"
description: "Writes the plan of a settled discussion as a decision summary in a strict template (Goal, Scope, Out of scope, UI copy, Edge cases & rules, Open assumptions), from the decisions already in the conversation. Lists decisions, not steps. Use when the user invokes /boilerlift:plan, or when boilerlift:interviewing or boilerlift:ship needs the plan or pull request body at the end of an interview."
disable-model-invocation: true
---

Turn the decisions already settled in this conversation into a decision summary. Write only; do not open a new round of questions.

Rules:

- **Settled decisions only.** Each line comes from the user's answers or from the code. Anything you would have to guess goes under **Open assumptions**, never into another section.
- **The template is strict.** `boilerlift:implement-plan-local` and `boilerlift:qa` read these headings: keep their names and order, and drop a section that would be empty. Never drop **Goal**.
- **Decisions, not steps.** The coder plans its own steps after reading the code. One decision per bullet, concrete enough to check in a review.
- **English**, except UI strings: copy them verbatim, in their language.
- **Where it goes is the caller's choice** (the reply for `boilerlift:interviewing`, the pull request body for `boilerlift:ship`). Invoked directly with `/boilerlift:plan`, reply with the summary. Never enter plan mode to write it.

## Template

```markdown
## Decisions

### Goal
<one or two sentences>

### Scope
- <what is included>

### Out of scope
- <what was excluded>

### UI copy
- `<exact string>` — <where it appears>

### Edge cases & rules
- <each rule or edge case the interview settled>

### Open assumptions
- <anything left to the coder's judgement>
```

## Example

For "Recognise my deployed workflows by their n8n id, recorded in my project":

```markdown
## Decisions

### Goal
A redeploy updates the n8n workflow it created before, matched by the id stored in `boilerlift.lock.json`, instead of creating a duplicate.

### Scope
- Write `{ "name": …, "n8nId": … }` per workflow to `boilerlift.lock.json` after each deploy.
- On deploy, update by `n8nId` when the lock has it; create otherwise.

### Out of scope
- Migrating projects deployed before the lock file existed.

### UI copy
- `Updated workflow {name} ({id})` — deploy log line

### Edge cases & rules
- Lock id unknown to n8n (deleted remotely): create a new workflow and overwrite the id.

### Open assumptions
- The lock file is committed, not git-ignored.
```
