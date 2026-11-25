---
name: "boilerlift:ship"
description: "One command from a backlog card in GitHub project 3 to a pull request that a separate session codes. Interviews the user on the card until shared understanding. On a single Ship click it runs scripts/create_pr.py to create the sibling worktree and the GitHub pull request, whose body is the decision summary, or resumes them when an open pull request already exists for the card. It runs npm run debug:setup in the worktree so any lift command runs on the latest code with npm start -- <cmd>, sets the card to In progress (the pull request closes it on merge), then starts a fresh auto-mode Claude session in the worktree on /boilerlift:implement-plan-local. Use only when the user invokes /boilerlift:ship [issue] in the boilerlift repository to ship, start or work on a backlog card. For an interview without a pull request, use /boilerlift:interviewing."
disable-model-invocation: true
allowed-tools: "Bash(${CLAUDE_SKILL_DIR}/scripts/create_pr.py *) Bash(${CLAUDE_SKILL_DIR}/../boilerlift:create-backlog-card/scripts/backlog.py *)"
---

Take one backlog card (an issue of `laurentvandelle/boilerlift` with `Card type` set in project 3) from interview to a pull request being coded in its own session, in the boilerlift repository. Every skill it uses is in this repository's `.claude/skills/`, and it adds one step to the generic ship flow: the worktree's `debug/` project is set up so the user can run any lift command on the latest code of the branch. The user does three things: answer the interview, click **Ship**, and later do the QA in the coding session. Do every other step without asking, because the Ship click already approved them.

Rules that hold for the whole run:

- **Run it from an auto-mode session.** The coding session starts in auto, and a session can't launch one in a higher mode than its own.
- **Ship is the only go-ahead.** Nothing is created, pushed or written to the project before the user clicks Ship. With no one to answer (an unattended run), stop after the interview and list the open questions: a pull request built on guessed decisions costs more than a late one.
- **`backlog.py` owns project 3.** It is `.claude/skills/boilerlift:create-backlog-card/scripts/backlog.py`, called below as `${CLAUDE_SKILL_DIR}/../boilerlift:create-backlog-card/scripts/backlog.py`. Exit 3 means the token lacks the `project` scope: say to run `gh auth refresh -s project` and stop.
- **`create_pr.py` owns git and GitHub.** On any non-zero exit, report its one `error:` line and stop. Redoing its steps by hand skips its collision checks and can leave a half-made branch or a second pull request.
- **Env files stay unread.** Report their paths and actions, never their contents, because they hold secrets.

## 1. Read the card

The argument is the card's issue: a number, `#14` or its URL in `laurentvandelle/boilerlift`. No argument: stop and say `/boilerlift:ship <issue>` is required.

Read it with `backlog.py read --issue <issue>`. Its title and body are the spec; `project_item.type` is the card type, `number` and `title` build the branch.

- Exit 2 or 4 (not an issue of this repository, or not found): stop, and report the `error:` line.
- No `project_item.type`: it is not a card yet. Stop and say to run `/boilerlift:create-backlog-card <issue>` first.
- Issue closed: stop and say so.
- `project_item.status` other than `Backlog` or `Ready`: say so in the reply, and continue.
- Body empty: say so, and run the interview from the title and the code alone.
- `open_prs` not empty: a past run already holds the decisions. Ask `Resume (Recommended)` (reuse that pull request and its worktree, skip the interview) or `Stop`. Stop and wait. On Resume, go to step 5 and use its resume command with `open_prs[0].branch`. More than one open pull request: list them and stop.

## 2. Map the code (subagent)

Before round 1, have an `Explore` subagent read the code the card touches, so only its summary enters this conversation and the interview stays sharp. Brief it with the card title, the card body and the repository root, and ask for this, under 40 lines:

```text
Files: <path — role in one line>, at most 10
Current behaviour: <what the code does today in the area the card changes>
Decisions the code does not settle: <one line each>
Conventions to follow: <nearest AGENTS.md rules that apply>
```

Without subagents, read the code yourself and keep only those notes.

## 3. Interview

Call the Skill tool twice, for `boilerlift:interviewing` and `boilerlift:domain-modeling`. If one doesn't load, read its `.claude/skills/<name>/SKILL.md` instead. Follow the interviewing rounds with the card and the summary as the subject, and apply domain modeling throughout. Ask only about the decisions the code does not settle.

Don't write `GLOSSARY.md` or an ADR during the interview: nothing is written before Ship, and the worktree is cut from `origin/HEAD`, so an edit in this checkout would miss the pull request. Settle each term or ADR with the user as a decision, and step 4 lists it under **Scope** (`Add to GLOSSARY.md: **<Term>**: …`, `Record ADR: <title> — <decision and why>`) for the coding session to write.

Replace its ending: `boilerlift:interviewing` replies with the `boilerlift:plan` summary and waits for approval, which would add a second go-ahead before Ship. Here the Ship click is the approval, and step 4 writes that summary as the pull request body instead of the reply. When no questions are left, end the turn with `wrap_up` (`mcp__ccd_turn__wrap_up`): `ask` is `Ship?` and `actions` are two replies:

- `Ship`: shared understanding reached; create the pull request and start coding.
- `One more round`: the user names what is missing; continue the interview.

Don't ask Ship with `AskUserQuestion`. Its answer stays inside the current turn, and that turn often began with the step 2 subagent's notification. The app refuses `start_session` in a turn started that way, so step 7 would fail and the user would have to confirm a second time. A `wrap_up` button sends the user's own message, which starts a fresh turn where steps 5–7 can run, `start_session` included. Without `wrap_up`, end the message with the same question and wait for the reply.

On `Ship`, run steps 4–8 in that turn without asking anything else.

## 4. Title and body

The title is one Conventional Commits subject, in English and in the imperative, lowercase after the colon, no period. Omit the scope when the area is obvious.

The body is two header lines, then the decision summary that the coding session builds from. Read `.claude/skills/boilerlift:plan/SKILL.md` and write the summary as it says: its template is strict, because `boilerlift:implement-plan-local` reads those headings.

```markdown
Closes #<issue number>

Branch name : {{BRANCH}}

<boilerlift:plan decision summary, starting at ## Decisions>
```

`Closes #N` links the pull request to the card, so the card shows it, a re-run finds it, and the merge closes the card (the board then sets it to `Done`). Keep `{{BRANCH}}` as written: the script doesn't know the branch until it builds it, so it replaces this token.

Example title, for card #14 "Recognise my deployed workflows by their n8n id, recorded in my project":

```text
feat(deploy): recognise workflows by their n8n id in boilerlift.lock.json
```

## 5. Create or resume the pull request

From the repository root, pass the body on stdin with a quoted heredoc so it stays one command. Requires `git`, `gh` and `python3` 3.9+.

```bash
${CLAUDE_SKILL_DIR}/scripts/create_pr.py \
  --title "<title>" \
  --type "<Card type>" --id "<issue number>" --name "<issue title>" \
  --body-file - <<'EOF'
<body>
EOF
```

The script builds the branch (`feature/`, `fix/`, `tech/` or `spike/` from the card type, then the issue number and title slugged and capped at 50 characters), fills `{{BRANCH}}`, creates `../{RepoName}-{lastSegment}` from `origin/HEAD`, trusts it, symlinks untracked `.env*` files, pushes an empty commit and opens the pull request. When the branch, the worktree and exactly one open pull request already exist, it resumes: it reuses them, creates nothing, and leaves the existing title and body as they are (it warns when it ignores yours). Any other collision exits 4.

On Resume (step 1), skip steps 2–4 and resume from the pull request's own branch (`open_prs[0].branch` from step 1), so an edited title can't build a new branch and open a second pull request:

```bash
${CLAUDE_SKILL_DIR}/scripts/create_pr.py --branch "<open_prs[0].branch>" --resume
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

Do this right after the setup above and before step 7, on a new pull request and on a resume alike:

```bash
${CLAUDE_SKILL_DIR}/../boilerlift:create-backlog-card/scripts/backlog.py status --issue <issue number> --status "In progress" --only-from "Backlog,Ready"
```

`--only-from` keeps a resumed card that is already `In review` where it is: the JSON then says `skipped`. On a non-zero exit, keep its `error:` line for the reply and continue, because the pull request doesn't depend on it.

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
| `background` | repository name, branch, pull request URL, card issue URL, and that the PR body holds the decisions taken in the interview |

```text
/boilerlift:implement-plan-local <pull request url>
If that skill did not load, read .claude/skills/boilerlift:implement-plan-local/SKILL.md and follow it for this pull request.
```

If the start is refused because this turn was not started by the user, end the turn with `wrap_up`, `ask` `Start the coding session?` and one reply `Start it`, then call `start_session` on that reply. Reaching this means the Ship step above was not asked through `wrap_up`.

If the start is refused because `auto` is higher than this session's mode, or `start_session` doesn't exist here, say why, print the prompt above and the `worktree` path so the user can start it by hand, and point to `README.md` in this skill's folder. The pull request and the worktree stay either way, and a re-run of `/boilerlift:ship` resumes them.

## 8. Reply

Reply in this order, one line each; omit a line that has nothing to say:

```text
PR: https://github.com/acme/boilerlift/pull/42 (resumed)
Branch: feature/14-recognise-my-deployed-workflows-by-their-n8n-id
Worktree: /Users/me/code/boilerlift-14-recognise-my-deployed-workflows-by-their-n8n-id
Env files: .env linked, apps/api/.env exists
Card: #14 In progress
Session: [feat(deploy): recognise workflows by their n8n id](#local_<id>)
Test: cd /Users/me/code/boilerlift-14-recognise-my-deployed-workflows-by-their-n8n-id && npm start -- <cmd>
```

The `Test:` line is always `Test: cd <worktree> && npm start -- <cmd>`, with the absolute `worktree` from the JSON and `<cmd>` left as written. Write `(resumed)` only when `resumed` is true, `Env files: none` when the list is empty, `Card: #<n> unchanged (<status>)` when step 6 skipped it, `Card: status update failed — <error>; set In progress on the board` when it failed, `Setup failed — <error>; run npm run debug:setup in the worktree` under `Test:` when the setup failed, and add `Worktree not trusted: accept the trust dialog when the session opens` when `trusted` is false.
