---
name: "boilerlift:inbox"
description: "Captures a raw boilerlift idea in seconds as a GitHub issue in laurentvandelle/boilerlift, which lands untriaged (no Card type) in the Backlog column of project 3: an English title and the idea cleaned up as English bullet points, nothing else. Run with /boilerlift:inbox [idea]. To turn an idea into a ready backlog card, use /boilerlift:create-backlog-card."
disable-model-invocation: true
model: haiku
effort: low
argument-hint: "[idea]"
allowed-tools: "Bash(${CLAUDE_SKILL_DIR}/scripts/inbox.py *)"
---

# Capture an idea

Speed is the whole point: one script call, one line of output. The user typed the command, so that is the approval: create the issue without asking. Refining, typing and splitting the idea into cards happen later in `/boilerlift:create-backlog-card`, so do none of that here: clean up the wording and structure it as bullets, nothing more.

The idea: $ARGUMENTS

## Workflow

1. **No idea text above** (empty or only whitespace): ask "What's the idea?" in one line and stop and wait. In an unattended run, stop there and create nothing, because an issue with no content is noise.
2. **Write the title**: 3 to 8 words, in English, because the repository and the agents that read its issues work in English. Name the idea itself ("Show workflow diff before deploy"), with no prefix such as `Idea:` or `[inbox]`: the issue lands untriaged (no Card type) in `Backlog`, which already marks it as an idea. Use plain words with no quotes, backticks or `$`, because the title sits inside double quotes in the shell.
3. **Write the body** once, before the call: the idea cleaned up, in English. The user often dictates, so remove hesitations, repetitions, filler words and transcription errors, and correct the syntax; translate when the input is not English. Change nothing on substance, because the body is the only record of what the user meant:
   - Add nothing: no new idea, no technical solution.
   - Drop no idea from the input.
   - Keep a lead or hypothesis hedged ("Possibly expressed in days"), never turned into a decision.
   - Keep commands, flags, names, code and `$` variables exactly as typed, with no backticks added around them.

   Write it as `-` bullet points, even a one-sentence idea (a single bullet). A single-topic idea gets flat bullets, one per point. An idea with several sub-topics gets one top-level bullet per sub-topic, its points nested under it with 2 spaces, all in this one issue.
4. **Create the issue** in one call, with the body on stdin:

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/inbox.py --title "Show workflow diff before deploy" <<'BOILERLIFT_IDEA_EOF'
   - lift deploy could print a diff of the changed nodes before pushing
   BOILERLIFT_IDEA_EOF
   ```

   Replace the title and the bullet lines with yours. Keep the quoted `'BOILERLIFT_IDEA_EOF'` delimiter, so quotes, backticks and `$` in the idea reach GitHub unchanged.
5. **Report** in one line: `Captured #[number]: [title] -- [url]`. Nothing else, no follow-up question.

On a non-zero exit, show its `error:` line. Exit 2 is a title or stdin problem: fix the title or the heredoc and retry once with the same cleaned body. Cleanup happens once, before the first call; the retry never rewrites the body. Any other exit (3 auth, 4 gh missing, 6 GitHub) is not yours to fix: stop. Run only this script, never a hand-written `gh` call, because it is the only pre-approved command.

## Gotchas

- The issue gets no label. Project 3's own automations add every new issue, yours or someone else's, to the board in the `Backlog` status, so make no project call: a second one would only slow capture down. `/boilerlift:create-backlog-card` later keeps it as the parent of its cards and archives it from the board.
- An idea that mentions several things is still one capture, with one top-level bullet per sub-topic. Splitting into issues is the card skill's job.
- A question rather than an idea ("how does lift status work?") is not a capture: answer that it is a question and create nothing.

## Example

Input: `/boilerlift:inbox euh lift status devrait montrer euh depuis quand un workflow n'a pas été déployé, peut-être en jours`

Call: `inbox.py --title "Show time since last deploy in lift status"` with this body on stdin:

```markdown
- lift status should show how long it has been since a workflow was last deployed
- Possibly expressed in days
```

Output: `Captured #14: Show time since last deploy in lift status -- https://github.com/laurentvandelle/boilerlift/issues/14`
