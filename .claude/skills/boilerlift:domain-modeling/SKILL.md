---
name: "boilerlift:domain-modeling"
description: Build and sharpen boilerlift's domain model. Use when the user invokes /boilerlift:domain-modeling, or when discussing boilerlift terminology, writing or editing GLOSSARY.md, or recording or editing an ADR in docs/adr/.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `GLOSSARY.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Files

boilerlift has a single context:

- `GLOSSARY.md` at the repository root: the domain language.
- `docs/adr/`: the architecture decision records. Its `README.md` holds the template, the numbering and when an ADR qualifies.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `GLOSSARY.md`, call it out immediately. "Your glossary defines 'target' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'connection': do you mean the instance connection or a connection between two nodes? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code archives every removed workflow, but you just said some are kept. Which is right?"

### Update GLOSSARY.md inline

When a term is resolved, update `GLOSSARY.md` right there, unless the calling skill says where the change goes instead. Don't batch these up: capture them as they happen. Follow the shape the file already uses (a `**Term**:` bullet under a `###` group, with `_Avoid_:` for the rejected words).

- **Be opinionated.** When several words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences. Define what it IS, not what it does.
- **Only project terms.** General programming concepts (timeouts, error types, utility patterns) don't belong, even if the project uses them a lot.
- **No implementation details.** `GLOSSARY.md` is not a spec, a scratch pad, or a store of implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer an ADR when the three tests in `docs/adr/README.md` all hold (hard to reverse, surprising without context, a real trade-off). If one is missing, skip it. Write it with the template and numbering in that file.
