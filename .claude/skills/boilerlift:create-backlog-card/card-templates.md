# Backlog card templates

Contents: Choosing the type · 1. Story · 2. Tech story · 3. Bug · 4. Investigation · Definition of Ready

Four short templates, one per card type. A card must be readable by a human and by a coding agent with no clarification round trip. Use the template of the chosen type exactly: same sections, same order, same emojis, nothing added, nothing left out. The issue title is the card name; the body starts at the template's `#` heading.

## Choosing the type

| Type | Question the card answers | Expected deliverable | Warning sign |
| --- | --- | --- | --- |
| story | What value for the user? | A visible, testable feature | No identifiable user, no business value |
| tech story | What risk do we remove, what do we want to learn? | Observable system behaviour | No operational benefit stated |
| bug | What gap between expected and actual? | Back to the expected behaviour | Not reproducible, or really a change request |
| investigation | Which decision is blocked? | A documented decision | No timebox, no closed question |

Torn between story and investigation: it is an investigation. Torn between bug and story: ask whether the expected behaviour was already specified (in docs, README, a test, a past card). If yes, it is a bug.

For boilerlift, "user" means the person running the `lift` CLI or importing `defineWorkflow` (a workflow author), not an n8n end user.

## 1. Story

Outcome-oriented title. No technique, no solution in the card. `Open questions` is `None` at creation: a card is created only when no question remains open. The `- [Question] -> owner: [WHO]` format is only for a question that appears after creation.

```markdown
# 📗 Story

## 👤 User story
As a [USER TYPE],
I want [CAPABILITY],
so that [OUTCOME / VALUE].

## 🧭 Context
[Why now, what problem it solves, what exists today.]

## 🎯 Scope
Included:
- [Item]
Excluded:
- [Item]

## 📏 Rules & constraints
- [Validation, permission or business rule]

## ✅ Acceptance criteria
- Given [context], when [action], then [observable result].
- Given [edge case], when [action], then [observable result].

## ❓ Open questions
None
```

## 2. Tech story

Name the risk to remove and what we want to learn, without imposing a solution, stack, component or endpoint. `Open questions` is `None` at creation, as for a story.

```markdown
# 🛠️ Tech story

## 🎯 Risk to address
[Risk or uncertainty to remove.]

## 🧪 What we want to learn
[What this work should teach us.]

## 🎯 Scope
Included:
- [Item]
Excluded:
- [Item]

## ✅ Acceptance criteria
- [Observable proof that the risk is reduced or that the learning is captured.]

## 🔒 What must not break
- [Existing behaviour to preserve.]

## ❓ Open questions
None
```

## 3. Bug

Never invent a value (version, environment, error message, reproduction step). If it is unknown, write `unknown`.

```markdown
# 🐞 Bug

## 📝 Summary
[One sentence: what breaks, where, for whom.]

## 💻 Environment
- boilerlift version / branch: [VALUE]
- Where: [local / CI]
- OS and Node version: [VALUE]
- n8n version and API key role: [VALUE]

## 📊 Frequency & severity
- Frequency: [always / intermittent / edge case]
- Severity: [blocker / critical / major / minor / cosmetic]
- Impact: [affected users, workaround available or not]

## 🔁 Steps to reproduce
1. [Precondition / starting state]
2. [Exact action, exact values]
3. [Exact action]

## 🎯 Expected result
[What should happen, stated precisely.]

## ❌ Actual result
[What happens instead: message, error, log, wrong value.]

## 📎 Evidence
- [Screenshot, video, log excerpt, request ID]
```

Example of a filled environment and result when the reporter knew only part of it:

```markdown
## 💻 Environment
- boilerlift version / branch: 0.2.0
- Where: local
- OS and Node version: macOS, Node unknown
- n8n version and API key role: unknown

## ❌ Actual result
`lift deploy` prints a stack trace and exits 1. Full output: unknown.
```

## 4. Investigation

Options are to explore: no solution is chosen at this stage. Production code written during an investigation is not merged; the decision is documented and a clean follow-up card is created.

```markdown
# 🔎 Investigation

## ❓ Question
[The single closed question this investigation must answer.]

## 🎯 Why it matters
[What is blocked or at risk until the answer is known.]

## ⏱️ Timebox
[Maximum allowed duration, e.g. 4h / 1 day. When time is up, the investigation ends.]

## 🧪 Options to explore
- [Option / approach / tool 1]
- [Option / approach / tool 2]

## ⚖️ Evaluation criteria
- [Cost, effort, maintainability, performance, risk, lock-in]

## 📦 Expected deliverable
- A documented recommendation
- The sources and tests used
- Follow-up card to create: [story / tech story]

## 🏁 Result
- Decision: [TO BE FILLED AT THE END]
- Rationale: [TO BE FILLED AT THE END]
- Follow-up card: [LINK]
```

## Definition of Ready

A card is ready only if every line for its type holds:

- All: every template section is present, in order, with no `[placeholder]` left (except the investigation `🏁 Result`, which stays as is).
- All: no implementation plan, file path to change, or chosen technical solution in the card.
- All: the content matches the type (a story with no user value, or a "bug" whose expected behaviour was never specified, fails).
- All: the card fits on one screen; longer is a signal to split.
- story: 3 to 5 Given/When/Then criteria, at least one edge case (error, refused access, missing data); Scope has Included and Excluded; Open questions is `None`.
- tech story: at least one observable acceptance criterion; Scope has Included and Excluded; What must not break is filled; Open questions is `None`.
- bug: the expected result is stated and observable; steps to reproduce and actual result are present, as exact as the reporter knows; every value the reporter could not give says `unknown`, never a guess.
- investigation: one closed question; a numeric timebox; at least two options; no decision filled in.
