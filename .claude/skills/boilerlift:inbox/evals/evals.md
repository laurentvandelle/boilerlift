# boilerlift:inbox evals

Run each prompt in a fresh session. Capture creates real issues: close them afterwards.

## 1. English one-liner

Prompt: `/boilerlift:inbox lift deploy could print a diff of the changed nodes before pushing`

- Exactly one call to `scripts/inbox.py`, no other Bash call and no question.
- Title is 3 to 8 English words, no `Idea:` prefix.
- Issue body is a single `-` bullet that keeps the idea's wording (it is already English and clean), with nothing added.
- Issue has no label; the skill makes no project call (the board's automation puts it in `Backlog`).
- Final message is one line with the issue number, title and URL.

## 2. French idea with quotes and a dollar sign

Prompt: `/boilerlift:inbox ajouter un flag --only "nom du workflow" à lift deploy, ex: lift deploy --only $NAME`

- Title and body are in English.
- Body is `-` bullets translating the idea, such as: add an --only "workflow name" flag to lift deploy, e.g. lift deploy --only $NAME.
- The double quotes and `$NAME` reach GitHub literally (the heredoc is quoted), with no backticks added around the command; nothing is added.

## 3. No idea text

Prompt: `/boilerlift:inbox`

- Asks one short question ("What's the idea?") and creates nothing until answered.

## 4. Several ideas in one line

Prompt: `/boilerlift:inbox lift status should show last deploy time, and also lift init should ask for the n8n URL`

- One issue, not two.
- Body has one top-level `-` bullet per sub-topic (lift status, lift init), each point nested under it with 2 spaces.
- Both ideas are kept; nothing is added.

## 5. Dictated French idea with hesitations and a hedged lead

Prompt: `/boilerlift:inbox euh alors lift status devrait euh devrait montrer depuis quand un workflow a pas été déployé, peut-être en jours je sais pas`

- Title and body are in English.
- Body is `-` bullets with no hesitation, repetition or filler ("euh", "alors", "je sais pas", the repeated "devrait").
- The lead stays hedged, such as "Possibly expressed in days", not stated as a decision.
- No idea is dropped and no technical solution is added.

## 6. One-sentence English idea

Prompt: `/boilerlift:inbox lift should warn when a workflow has no tags`

- Body is exactly one `-` bullet.

## 7. Two sub-topics

Prompt: `/boilerlift:inbox for lift deploy, show a summary at the end and exit non-zero on any failure; for lift init, offer to create the .env file`

- One issue, not two.
- Body has two top-level `-` bullets, one for lift deploy and one for lift init.
- The lift deploy points (summary at the end, non-zero exit on failure) are nested under it with 2 spaces; the lift init point is nested under its own bullet.

## 8. Command with a flag and a dollar variable

Prompt: `/boilerlift:inbox lift deploy --only $NAME should fail if the name matches no workflow`

- The body keeps `lift deploy --only $NAME` exactly as typed: no backticks added, `$NAME` not expanded or rewritten.
- Exactly one call to `scripts/inbox.py` with the quoted `'BOILERLIFT_IDEA_EOF'` heredoc.

## 9. No idea text, unattended

Prompt: `/boilerlift:inbox` in a run with nobody to answer.

- Asks "What's the idea?" and stops; no issue is created and `scripts/inbox.py` is never called.
