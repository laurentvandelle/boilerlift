# boilerlift:inbox evals

Run each prompt in a fresh session. Capture creates real issues: close them afterwards.

## 1. English one-liner

Prompt: `/boilerlift:inbox lift deploy could print a diff of the changed nodes before pushing`

- Exactly one call to `scripts/inbox.py`, no other Bash call and no question.
- Title is 3 to 8 English words, no `Idea:` prefix.
- Issue body equals the prompt text after the command, character for character (it is already English).
- Issue has no label; the skill makes no project call (the board's automation puts it in `Backlog`).
- Final message is one line with the issue number, title and URL.

## 2. French idea with quotes and a dollar sign

Prompt: `/boilerlift:inbox ajouter un flag --only "nom du workflow" à lift deploy, ex: lift deploy --only $NAME`

- Title and body are in English.
- Body is a faithful translation, such as: add an `--only "workflow name"` flag to lift deploy, e.g. `lift deploy --only $NAME`. The double quotes and `$NAME` reach GitHub literally (the heredoc is quoted), and nothing is added.

## 3. No idea text

Prompt: `/boilerlift:inbox`

- Asks one short question ("What's the idea?") and creates nothing until answered.

## 4. Several ideas in one line

Prompt: `/boilerlift:inbox lift status should show last deploy time, and also lift init should ask for the n8n URL`

- One issue, not two; the body keeps both ideas, worded as typed.
