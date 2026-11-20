---
name: "boilerlift:ship"
description: "One command from a Notion card to a pull request that a separate session codes. Interviews the user on the card until shared understanding. On a single Ship click it runs scripts/create_pr.py to create the sibling worktree and the GitHub pull request, whose body is the decision summary, or resumes them when an open pull request already exists for the card. It runs npm run debug:setup in the worktree so any lift command runs on the latest code with npm start -- <cmd>, sets the card to In Progress with its PR URL, then starts a fresh auto-mode Claude session in the worktree on /LV:implement-plan-local. Use only when the user invokes /boilerlift:ship [notion-url] in the boilerlift repository to ship, start or work on a Notion card. For an interview without a pull request, use /LV:interviewing or /LV:interview-me. For the GitHub runner flow, use /LV:to-pr-remote."
disable-model-invocation: true
allowed-tools: "Bash(${CLAUDE_SKILL_DIR}/scripts/create_pr.py *)"
---

Take one Notion card from interview to a pull request being coded in its own session, in the boilerlift repository. This is the global `LV:ship` vendored with its scripts, plus one step: the worktree's `debug/` project is set up so the user can run any lift command on the latest code of the branch. The user does three things: answer the interview, click **Ship**, and later do the QA in the coding session. Do every other step without asking, because the Ship click already approved them.

Rules that hold for the whole run:

- **Run it from an auto-mode session.** The coding session starts in auto, and a session can't launch one in a higher mode than its own.
- **Ship is the only go-ahead.** Nothing is created, pushed or written to Notion before the user clicks Ship. With no one to answer (an unattended run), stop after the interview and list the open questions: a pull request built on guessed decisions costs more than a late one.
- **`create_pr.py` owns git and GitHub.** On any non-zero exit, report its one `error:` line and stop. Redoing its steps by hand skips its collision checks and can leave a half-made branch or a second pull request.
- **Env files stay unread.** Report their paths and actions, never their contents, because they hold secrets.

## 1. Read the card

The argument is a Notion page URL (`notion.so` or `app.notion.com`). No URL: stop and say `/boilerlift:ship <notion-url>` is required.

Fetch it with `Notion:notion-fetch`. Its content is the spec. Read the properties `Type`, `ID` (`userDefined:ID`) and `Nom`: the script builds the branch from them.

- Fetch fails or the page is not a card: stop, and report the error and the URL.
- `ID` or `Nom` missing: stop and say which one. A `Type` other than `story`, `bug` or `tech story`, or none, gives a branch with no prefix: say so in the reply.
- Card content empty: say so, and run the interview from the title and the code alone.
- `GitHub PR URL` already set: a past run already holds the decisions, so the `ID` and `Nom` checks above don't apply. Ask `Resume (Recommended)` (reuse that pull request and its worktree, skip the interview) or `Stop`. Stop and wait. On Resume, go to step 5 and use its resume command.

## 2. Map the code (subagent)

Before round 1, have an `Explore` subagent read the code the card touches, so only its summary enters this conversation and the interview stays sharp. Brief it with the card title, the card content and the repository root, and ask for this, under 40 lines:

```text
Files: <path — role in one line>, at most 10
Current behaviour: <what the code does today in the area the card changes>
Decisions the code does not settle: <one line each>
Conventions to follow: <nearest AGENTS.md rules that apply>
```

Without subagents, read the code yourself and keep only those notes.

## 3. Interview

Read `~/.claude/skills/LV:interviewing/SKILL.md` and follow its rounds, with the card and the summary as the subject. Ask only about the decisions the code does not settle.

Replace its ending: `LV:interviewing` replies with the `LV:plan` summary and waits for approval, which would add a second go-ahead before Ship. Here the Ship click is the approval, and step 4 writes that summary as the pull request body instead of the reply. When no questions are left, end the turn with `wrap_up` (`mcp__ccd_turn__wrap_up`): `ask` is `Ship?` and `actions` are two replies:

- `Ship`: shared understanding reached; create the pull request and start coding.
- `One more round`: the user names what is missing; continue the interview.

Don't ask Ship with `AskUserQuestion`. Its answer stays inside the current turn, and that turn often began with the step 2 subagent's notification. The app refuses `start_session` in a turn started that way, so step 7 would fail and the user would have to confirm a second time. A `wrap_up` button sends the user's own message, which starts a fresh turn where steps 5–7 can run, `start_session` included. Without `wrap_up`, end the message with the same question and wait for the reply.

On `Ship`, run steps 4–8 in that turn without asking anything else.

## 4. Title and body

The title is one Conventional Commits subject, in English and in the imperative, lowercase after the colon, no period. Omit the scope when the area is obvious.

The body is two header lines, then the decision summary that the coding session builds from. Read `~/.claude/skills/LV:plan/SKILL.md` and write the summary as it says: its template is strict, because `LV:implement-plan-local` reads those headings.

```markdown
Spec: <notion url>

Branch name : {{BRANCH}}

<LV:plan decision summary, starting at ## Decisions>
```

Keep `{{BRANCH}}` as written: the script doesn't know the branch until it builds it, so it replaces this token.

Example title, for a card `BOILERLIFT-14` "Recognise my deployed workflows by their n8n id, recorded in my project":

```text
feat(deploy): recognise workflows by their n8n id in boilerlift.lock.json
```

## 5. Create or resume the pull request

From the repository root, pass the body on stdin with a quoted heredoc so it stays one command. Requires `git`, `gh` and `python3` 3.9+.

```bash
${CLAUDE_SKILL_DIR}/scripts/create_pr.py \
  --title "<title>" \
  --type "<Type>" --id "<ID>" --name "<Nom>" \
  --body-file - <<'EOF'
<body>
EOF
```

The script builds the branch (`feature/`, `fix/` or `tech/` from `Type`, then the `ID` and `Nom` slugged and capped at 50 characters), fills `{{BRANCH}}`, creates `../{RepoName}-{lastSegment}` from `origin/HEAD`, trusts it, symlinks untracked `.env*` files, pushes an empty commit and opens the pull request. When the branch, the worktree and exactly one open pull request already exist, it resumes: it reuses them, creates nothing, and leaves the existing title and body as they are (it warns when it ignores yours). Any other collision exits 4. The new branch may differ from the card's `Git branch` formula; the `GitHub PR URL` property is the link that counts.

On Resume (step 1), skip steps 2–4 and resume from the pull request's own branch, so an edited `Nom` can't build a new branch and open a second pull request:

Run these as two separate calls, because only the script is pre-approved:

```bash
gh pr view "<GitHub PR URL>" --json headRefName -q .headRefName
```

```bash
${CLAUDE_SKILL_DIR}/scripts/create_pr.py --branch "<headRefName>" --resume
```

`--resume` never creates anything. Exit 4 there means nothing is resumable (pull request closed, worktree gone or on another branch): report the script's `error:` line and stop.

Stdout is one JSON object: `pr_url`, `branch`, `base`, `worktree`, `resumed`, `trusted`, `env_files` (each with `path` and `action`).

### Set up `debug/`

Right after the script exits 0, on a new pull request and on a resume alike, run the setup with the `worktree` from the JSON as the working directory:

```bash
cd "<worktree>" && npm run debug:setup
```

It installs the root dependencies, builds `dist/`, installs `debug/` dependencies, and links `debug/boilerlift.lock.json` to the main checkout's copy, so every worktree shares one record of the instance. It is safe to run again and never runs lift. On a non-zero exit, keep its last `error:` line for the reply and continue: the pull request does not depend on it, and the user can run it again by hand.

## 6. Update the card

Do this right after the setup above and before step 7, on a new pull request and on a resume alike. A re-run finds the pull request only through `GitHub PR URL`, so a card left without it opens a second pull request next time.

Call the Notion MCP `notion-update-page` tool (load it with ToolSearch first if it is only listed as deferred) on the card URL from step 1:

```json
{
  "page_id": "<card url>",
  "command": "update_properties",
  "allow_async": false,
  "properties": {
    "GitHub PR URL": "<pr_url>",
    "Status": "In Progress 🔁"
  }
}
```

Use the property names exactly as the step 1 fetch shows them. Leave `Status` out when the card is already past `In Progress 🔁`: a resumed card may be in review, and moving it back would mislead the board. Write `"Status"` only when it is `Backlog 📥` or `Todo 📋`.

If the call fails or returns warnings, keep the error for the reply and continue, because the pull request doesn't depend on it. Only then, ask the user in the reply to paste `pr_url` into `GitHub PR URL` by hand.

## 7. Launch the coding session

Start it with `start_session` (`mcp__ccd_session__start_session`; load it with ToolSearch first if it is only listed as deferred):

| Field | Value |
|-------|-------|
| `initiation` | `user_asked` |
| `context` | `fresh` |
| `cwd` | the absolute `worktree` from the JSON |
| `use_worktree` | `false`, because the worktree already exists |
| `permission_mode` | `auto` |
| `title` | the pull request title |
| `prompt` | the two lines below |
| `background` | repository name, branch, pull request URL, Notion URL, and that the PR body holds the decisions taken in the interview |

```text
/LV:implement-plan-local <pull request url>
If that skill did not load, read ~/.claude/skills/LV:implement-plan-local/SKILL.md and follow it for this pull request.
```

If the start is refused because this turn was not started by the user, end the turn with `wrap_up`, `ask` `Start the coding session?` and one reply `Start it`, then call `start_session` on that reply. Reaching this means the Ship step above was not asked through `wrap_up`.

If the start is refused because `auto` is higher than this session's mode, or `start_session` doesn't exist here, say why, print the prompt above and the `worktree` path so the user can start it by hand, and point to `README.md` in this skill's folder. The pull request and the worktree stay either way, and a re-run of `/boilerlift:ship` resumes them.

## 8. Reply

Reply in this order, one line each; omit a line that has nothing to say:

```text
PR: https://github.com/acme/boilerlift/pull/42 (resumed)
Branch: feature/boilerlift-14-recognise-my-deployed-workflows-by
Worktree: /Users/me/code/boilerlift-14-recognise-my-deployed-workflows-by
Env files: .env linked, apps/api/.env exists
Notion: In Progress 🔁, PR URL set
Session: [feat(deploy): recognise workflows by their n8n id](#local_<id>)
Test: cd /Users/me/code/boilerlift-14-recognise-my-deployed-workflows-by && npm start -- <cmd>
```

The `Test:` line is always `Test: cd <worktree> && npm start -- <cmd>`, with the absolute `worktree` from the JSON and `<cmd>` left as written. Write `(resumed)` only when `resumed` is true, `Env files: none` when the list is empty, `Notion: update failed — <error>; set GitHub PR URL by hand` when step 6 failed, `Setup failed — <error>; run npm run debug:setup in the worktree` under `Test:` when the setup failed, and add `Worktree not trusted: accept the trust dialog when the session opens` when `trusted` is false.
