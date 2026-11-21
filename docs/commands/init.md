# `lift init`

Starts a Boilerlift project: it writes the files a person or an AI agent needs to work on a first workflow, then prints the next steps. It needs no `boilerlift.config.ts`, so it runs in an empty folder.

```sh
lift init            # in the current folder
lift init my-app     # in my-app, created when missing
lift init --json     # the result as JSON, for scripts and AI agents
```

`lift help init` prints every option and the exit codes.

## What it writes

| File | What it is |
| --- | --- |
| `boilerlift.config.ts` | One target, `dev`: `url` from `N8N_URL`, `apiKey` from `N8N_API_KEY`, workflows in `./workflows` (see [Configure your targets](../configuration.md)) |
| `workflows/hello.workflow.ts` | An example workflow: a manual trigger, then a Code node, with no credentials |
| `code/hello.ts`, `code/hello.test.ts` | The JavaScript of that Code node, as a function the workflow inlines with `toString()`, and its Vitest test |
| `package.json` | `"type": "module"`, the `#code/*` import, `boilerlift`, ESLint, TypeScript and Vitest as devDependencies, and the scripts `verify` (`lint`, `typecheck`, `test`), `ping`, `check` (`lift deploy --dry-run`), `deploy`, `status`, `n8n:publish`, `creds`, `clean` and `n8n` |
| `scripts/n8n.ts`, `scripts/n8n.test.ts` | `npm run n8n -- <METHOD> <path> [body]`: one call to the n8n public API at `N8N_URL` + `/api/v1<path>`, with the key of `N8N_API_KEY` (read from `.env`) in the `X-N8N-API-KEY` header. It prints the response body, never the key. The body is JSON, as an argument or `-` for stdin |
| `tsconfig.json` | Type-checking for the config, the workflow files, the Code node functions, `scripts/` and the hook |
| `eslint.config.mjs` | `npm run lint`: no relative import, a Code node function imports nothing, only tests import Vitest |
| `.env.example` | `N8N_URL=` and `N8N_API_KEY=`, with empty values |
| `.gitignore` | `node_modules`, `.env` and `boilerlift.lock.json` |
| `README.md` | The next steps |

It also writes the Agent kit, for AI agents:

| File | What it is |
| --- | --- |
| `AGENTS.md` | Instructions for AI agents: every command, run with `--json`, how to read the result and the exit codes, the Guarded commands (ask for a yes in the chat first), `npm run n8n`, and links to the `BOILERLIFT:` skills |
| `CLAUDE.md` | One line, `@AGENTS.md`, so Claude Code reads `AGENTS.md` |
| `.github/copilot-instructions.md` | One line that points GitHub Copilot to `AGENTS.md` |
| `workflows/AGENTS.md`, `code/AGENTS.md` | The rules of each folder |
| `ARCHITECTURE.md`, `GLOSSARY.md` | The layout of the project, and the words of n8n and Boilerlift |
| `docs/` | How to write the instruction files, the tests and an architecture decision |
| `.claude/skills/BOILERLIFT:ship/` | The entry skill: `/BOILERLIFT:ship <what the workflow should do>` interviews the user (trigger, inputs, services and credentials, expected result), shows a mermaid diagram of the nodes and a short summary, and on the user's "Shared understanding" writes the files, runs `npm run verify` and `lift deploy -t dev --dry-run`, deploys a draft on `dev` and gives the QA scenarios. It publishes only on a separate yes |
| `.claude/skills/BOILERLIFT:interviewing/` | An interview on any topic, in rounds of multiple-choice questions, until shared understanding |
| `.claude/skills/BOILERLIFT:plan/` | The summary of the workflow, in a strict template, shown in the chat only |
| `.claude/skills/BOILERLIFT:qa/` | The QA scenarios to run in n8n on the deployed draft |
| `.claude/hooks/guard.ts`, `.claude/hooks/guard.test.ts` | A Claude Code `PreToolUse` hook, run by Node.js as TypeScript. It makes Claude Code ask the user before each Guarded command: `lift publish`, `lift clean` or `lift reset` without `--dry-run`, `lift deploy` without an explicit `-t dev` (no target, another one, or `--all`), and `npm run n8n` with a method other than `GET`, through `npx`, `npm exec`, the `boilerlift` alias, the npm scripts and chained commands. It denies a Bash command, a `Read` or a `Grep` that would show a `.env` file (`.env.example` is fine) |
| `.claude/settings.json` | Wires the hook for the `Bash`, `Read` and `Grep` tools, and denies `Read` on `.env` and its usual variants (`.env.local`, `.env.production`…) |

The files come from [`templates/project/`](../../templates/project/), which ships in the npm package.

## Never overwrites

A file already there is left as it is, and reported as skipped: init never overwrites a file and never appends to one, `AGENTS.md`, `CLAUDE.md`, `.gitignore` and each file of the Agent kit included: a skill folder that is partly there gets only its missing files. In a folder that already holds part of a project, init creates what is missing and exits 0. Run again, it reports every file as skipped.

When `.claude/settings.json` is already there, init leaves it as it is and still creates the hook script: one more next step gives the entry to add to the `"hooks"` → `"PreToolUse"` list of that file, so Claude Code runs the hook:

```json
{ "matcher": "Bash|Read|Grep", "hooks": [{ "type": "command", "command": "node --disable-warning=ExperimentalWarning \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.ts\"" }] }
```

init never writes `.env`, so no secret is ever written, and never runs `npm install`.

```text
✓ .env.example
– .gitignore (already there, left as it is)
✓ AGENTS.md
✓ boilerlift.config.ts
…

The project is not ready yet. Run these commands, in order, to finish the setup:
→ cd my-app
→ npm install
→ cp .env.example .env, then fill in N8N_URL and N8N_API_KEY
→ npx lift ping
```

`✓` created, `–` skipped, `✗` could not be written, with the reason. The project is not usable until the commands after the `→` are run: init prints them every time, even when every file was skipped.

## When a write fails

A file that cannot be written (permission denied, full disk) does not stop the others. It is marked `✗` with the reason, and init exits 12. Fix the cause and run `lift init` again: it writes only the missing files.

A folder argument that is an existing file is a usage error: nothing is written, exit 1.

## JSON

```json
{
  "folder": "my-app",
  "files": [
    { "path": ".env.example", "status": "created" },
    { "path": ".gitignore", "status": "skipped" },
    { "path": "README.md", "status": "failed", "reason": "EACCES: permission denied, open '…'" }
  ],
  "next": ["cd my-app", "npm install", "cp .env.example .env, then fill in N8N_URL and N8N_API_KEY", "npx lift ping"],
  "exitCode": 12
}
```

`path` is relative to the project folder. `status` is `created`, `skipped` or `failed`.
