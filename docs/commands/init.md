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
| `workflows/hello.workflow.ts` | An example workflow: a manual trigger, then a Set node, with no credentials |
| `package.json` | `"type": "module"`, `boilerlift` as a devDependency, and the scripts `ping`, `check` (`lift deploy --dry-run`), `deploy`, `status`, `n8n:publish`, `creds` and `clean` |
| `tsconfig.json` | Type-checking for the config and the workflow files in the editor |
| `.env.example` | `N8N_URL=` and `N8N_API_KEY=`, with empty values |
| `.gitignore` | `node_modules`, `.env` and `boilerlift.lock.json` |
| `README.md` | The next steps |
| `AGENTS.md` | Instructions for AI agents: every command, run with `--json`, how to read the result and the exit codes, and which commands need the user's go-ahead |
| `CLAUDE.md` | One line, `@AGENTS.md`, so Claude Code reads `AGENTS.md` |

The files come from [`templates/project/`](../../templates/project/), which ships in the npm package.

## Never overwrites

A file already there is left as it is, and reported as skipped: init never overwrites a file and never appends to one, `AGENTS.md`, `CLAUDE.md` and `.gitignore` included. In a folder that already holds part of a project, init creates what is missing and exits 0. Run again, it reports every file as skipped.

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
