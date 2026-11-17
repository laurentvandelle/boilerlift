# Architecture

Operational rules for agents live in `AGENTS.md`. This file is background.

## Intent

`n8nlift` is a command-line tool written in TypeScript and published to npm. It reads and validates n8n workflows kept as typed `.workflow.ts` files (an n8n export passed to `defineWorkflow`) or `.json` exports, and delivers them to the user's n8n instance. n8n node definitions are not part of this repository. The CLI has `help`, `version`, `ping` (checks the instance connection) and `deploy` (delivers `./workflows` to the instance as drafts, or shows its plan with `--dry-run`).

## Modules

- `src/bin.ts` — the `n8nlift` executable (`bin` in `package.json`). Awaits `runCli` with `process.argv` and the context of the process, then writes the result. An error that escapes a command is printed with its stack, exit 1.
- `src/cli/node-context.ts` — builds the `CommandContext` of the real process: the n8nlift version, the environment, the `./.env` text, the Node.js version, `fetch`, and the reader of the workflow files. `src/cli/cli.model.ts` documents each field.
- `src/index.ts` — the package entry point, imported by workflow files as `'n8nlift'`. Exports `defineWorkflow` and the workflow types (`Workflow`, `WorkflowNode`, `WorkflowConnection`, `WorkflowConnections`) from `core/compile/`.
- `src/cli/` — the CLI: `run-cli.ts` (dispatch), `registry.ts` (the list of commands), `cli.model.ts` (contracts), `define-command.ts` (builds a command whose option values are typed by its options) and `commands/<name>/`, one folder per command. Commands are async: `run` returns `Promise<CliResult>`.
- `src/core/` — the work behind the commands, one folder per concern:
  - `compile/` reads and validates workflow files: `defineWorkflow` and its types for the editor, and a pure loader that checks each export's shape, nodes, connections and stable name before deploy.
  - `deliver/` is deploy: `plan-deploy.ts` reads the instance and decides each workflow's action (also behind `deploy --dry-run`), `apply-plan.ts` runs the writes, `deploy-failure.ts` says which failures stop the run and with which exit code, and `stable-tag.ts` matches workflows by their `n8nlift:<stable-name>` tag.
  - `connection/` is ping: the checks behind `n8nlift ping`.
  - Shared folders: `config/` (reads `N8N_URL` and `N8N_API_KEY` from the environment and `.env`), `n8n/` (the client for the instance's public API, which parses every answer once), `exit/` (the exit codes of every command), `guard/` (`isRecord`) and `result/` (the `Result` type of expected failures).
- `debug/` — a separate npm package that depends on `file:../dist` and runs the built `dist/bin.js`, used to try the CLI as a user would.

Why this split: `docs/adr/0001-cli-and-core-layers.md`. Why typed n8n exports: `docs/adr/0005-workflow-files-are-typed-n8n-exports.md`. Why tags and drafts: `docs/adr/0002-tag-identity-and-draft-updates.md`, amended by `docs/adr/0003-draft-support-from-spec-and-unarchive-restore.md`. Why deploy plans before it writes: `docs/adr/0004-deploy-plans-before-it-writes.md`. Why failures are returned: `docs/adr/0006-expected-failures-are-returned-results.md`.

## Boundaries

- `cli` may import `core`. `core` never imports `cli`.
- `deliver` may import `compile`. `compile` never imports `deliver`, `n8n` or `connection`. Shared `core/` folders import neither stage. `deliver` and `connection` do not import each other.
- A command imports only its own folder, the CLI contracts and `core`. Never another command.
- Commands and `core/` get the outside world through their parameters (the injected `CommandContext`, the `N8nClient` port) and return their output. `node-context.ts` and `bin.ts` do the I/O.
- `debug/` sees only the published surface in `dist/`, never `src/`.

`npm run lint:check` enforces the `src/` rules: `eslint-plugin-boundaries` the import directions, and the hidden-dependency bans of `eslint.config.mts` the I/O rule. No check enforces the `debug/` rule.

## Runtime

`npm run build` compiles `src/` with `tsc` (module `node20`, target `ES2024`, CommonJS output since `package.json` has no `"type"`) into `dist/`, emitting `.d.ts` and source maps. Imports keep the `#src/` alias in `dist/`: Node.js resolves it at runtime through the `imports` field of `package.json` (`#src/*` → `./dist/*.js`), so no rewrite step runs. `package.json` points `main` at `dist/index.js` and `types` at `dist/index.d.ts`. The minimum runtime is Node.js 22.18 (`engines` in `package.json`); development uses Node.js 24 (`.nvmrc`), and CI tests both. `npm start` builds, then runs `debug/main.ts` with `node` (Node.js 22.18 and later strip TypeScript types natively). With no argument, `debug/main.ts` runs a real `n8nlift deploy` of `debug/workflows` to the instance in `debug/.env`, so `npm start` writes to that instance.

## Out of scope

No runtime dependencies, no bundler, no ESM dual build.
