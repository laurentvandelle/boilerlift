# `lift init`

Creates a new Boilerlift project in a folder: it writes the files a person or an AI agent needs to work on a first workflow, then prints the next steps. It needs no `boilerlift.config.ts`.

```sh
lift init my-app          # in my-app, created when missing
lift init my-app --json   # the result as JSON, for scripts and AI agents
```

`lift help init` prints every option and the exit codes.

## Requirements

`lift init` needs [git](https://git-scm.com/downloads) on the PATH and a network connection: it fetches the Project template with `git clone --depth 1` of the tag `vX.Y.Z` of [boilerlift-template](https://github.com/laurentvandelle/boilerlift-template), where `X.Y.Z` is the version of `lift` that runs. The clone goes into a temp folder, which is removed afterwards.

The folder must be new, empty, or hold only `.git`: init never writes into a folder that holds anything else. To bring an existing project to a new version of Boilerlift, see the [migration guide](../migration.md).

## What it writes

The project is the [Project template](https://github.com/laurentvandelle/boilerlift-template) of this version of `lift`, as is:

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

The project of version `X.Y.Z` holds the same files as the tag `vX.Y.Z` of boilerlift-template. "Use this template" on GitHub gives `main`, the template of the latest version: see [Without `lift init`](../manual-install.md#without-lift-init).

## Next steps

init only writes files. It never runs `git init` or `npm install`, and never writes `.env`, so no secret is ever written.

```text
✓ .claude/hooks/guard.test.ts
✓ .claude/hooks/guard.ts
…
✓ workflows/hello.workflow.ts

The project is not ready yet. Run these commands, in order, to finish the setup:
→ cd my-app
→ git init
→ npm install
→ cp .env.example .env, then fill in N8N_URL and N8N_API_KEY
→ npx lift ping
```

`✓` created, `✗` could not be written, with the reason. `git init` is left out when the folder already held `.git`, and `cd` when the folder is `.`. The project is not usable until the commands after the `→` are run.

## When it stops

| Situation | Exit | What is written |
| --- | --- | --- |
| No folder given, or two | 1 | Nothing |
| The folder is a file, or holds anything but `.git` | 1 | Nothing. The message names the folder and links the [migration guide](../migration.md) |
| git is not installed, or not on the PATH | 13 | Nothing. The message names the template URL and links the git download page |
| boilerlift-template has no tag for this version (a local or unreleased build) | 13 | Nothing. The message names the missing tag. There is no fallback to `main` |
| The network is down, or the repository cannot be reached | 13 | Nothing. The message gives git's own reason |
| A file cannot be written (permission denied, full disk) | 12 | Every other file. The failed ones are marked `✗` with the reason, and nothing is rolled back |

The template is fetched in full before the folder is created, so a failed fetch leaves no folder behind.

## JSON

```json
{
  "folder": "my-app",
  "files": [
    { "path": ".env.example", "status": "created" },
    { "path": "README.md", "status": "failed", "reason": "EACCES: permission denied, open '…'" }
  ],
  "next": ["cd my-app", "git init", "npm install", "cp .env.example .env, then fill in N8N_URL and N8N_API_KEY", "npx lift ping"],
  "exitCode": 12
}
```

`path` is relative to the project folder. `status` is `created` or `failed`.

When init stops before writing anything, `--json` prints the error instead, with its `kind` (`no-folder`, `too-many-folders`, `folder-is-file`, `folder-not-empty`, `git-not-found`, `tag-not-found` or `fetch-failed`):

```json
{
  "error": { "kind": "tag-not-found", "message": "Cannot get the Project template from https://github.com/laurentvandelle/boilerlift-template.git: it has no tag v0.3.0, the tag of this version of lift." },
  "exitCode": 13
}
```
