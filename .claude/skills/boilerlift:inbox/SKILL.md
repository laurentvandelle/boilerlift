---
name: "boilerlift:inbox"
description: "Captures a raw boilerlift idea in seconds as a GitHub issue in laurentvandelle/boilerlift, which lands untriaged (no Card type) in the Backlog column of project 3: an English title and the idea in English as the body, nothing else. Run with /boilerlift:inbox [idea]. To turn an idea into a ready backlog card, use /boilerlift:create-backlog-card."
disable-model-invocation: true
model: haiku
argument-hint: "[idea]"
allowed-tools: "Bash(${CLAUDE_SKILL_DIR}/scripts/inbox.py *)"
---

# Capture an idea

Speed is the whole point: one script call, one line of output. The user typed the command, so that is the approval: create the issue without asking. Refining, typing and splitting the idea happen later in `/boilerlift:create-backlog-card`, so leave all of that out here.

The idea: $ARGUMENTS

## Workflow

1. **No idea text above** (empty or only whitespace): ask "What's the idea?" in one line and stop and wait. In an unattended run, stop there and create nothing, because an issue with no content is noise.
2. **Write the title**: 3 to 8 words, in English, because the repository and the agents that read its issues work in English. Name the idea itself ("Show workflow diff before deploy"), with no prefix such as `Idea:` or `[inbox]`: the board's `Inbox` column already says it. Use plain words with no quotes, backticks or `$`, because the title sits inside double quotes in the shell.
3. **Create the issue** in one call. The body is the idea in English: copied as typed when it is already English, otherwise translated faithfully, sentence for sentence, keeping commands, flags, names and code as they are. Add, drop or interpret nothing, because the body is the only record of what the user meant; fix only the grammar a translation needs.

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/inbox.py --title "Show workflow diff before deploy" <<'BOILERLIFT_IDEA_EOF'
   lift deploy could print a diff of the changed nodes before pushing
   BOILERLIFT_IDEA_EOF
   ```

   Replace the title and the middle line with yours. Keep the quoted `'BOILERLIFT_IDEA_EOF'` delimiter, so quotes, backticks and `$` in the idea reach GitHub unchanged.
4. **Report** in one line: `Captured #[number]: [title] -- [url]`. Nothing else, no follow-up question.

On a non-zero exit, show its `error:` line. Exit 2 is a title or stdin problem: fix the title or the heredoc and retry once, never changing the body, because it must stay the user's meaning. Any other exit (3 auth, 4 gh missing, 6 GitHub) is not yours to fix: stop. Run only this script, never a hand-written `gh` call, because it is the only pre-approved command.

## Gotchas

- The issue gets no label. Project 3's own automations add every new issue, yours or someone else's, to the board in the `Backlog` status, so make no project call: a second one would only slow capture down. `/boilerlift:create-backlog-card` later keeps it as the parent of its cards and archives it from the board.
- An idea that mentions several things is still one capture. Splitting is the card skill's job.
- A question rather than an idea ("how does lift status work?") is not a capture: answer that it is a question and create nothing.

## Example

Input: `/boilerlift:inbox lift status devrait montrer depuis quand un workflow n'a pas été déployé`

Call: `inbox.py --title "Show time since last deploy in lift status"` with this body on stdin: `lift status should show how long it has been since a workflow was last deployed`

Output: `Captured #14: Show time since last deploy in lift status -- https://github.com/laurentvandelle/boilerlift/issues/14`
