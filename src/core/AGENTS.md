# AGENTS.md — src/core

## Prohibitions

- Each folder imports only what its `boundaries/dependencies` policy in `eslint.config.mts` allows. Lint enforces all of these:
  - `compile/` imports only `config/` and `common/`. It never imports `deliver/`, `n8n/` or `connection/`: no network.
  - `deliver/` (deploy) may import `compile/`, `config/` and `n8n/`. `connection/` (ping) may import `config/` and `n8n/`. Neither imports the other.
  - A shared folder (`config/`, `n8n/`, `common/`) imports neither `compile/` nor `deliver/`.
  - `core/` never imports `src/services/`. Use the `N8nClient` port of `n8n/n8n.model.ts`; its adapter lives in `src/services/n8n/`.
- A new folder needs its own element and policy in `eslint.config.mts`: a file in no element fails `boundaries/no-unknown-files`.
- A `StableName`, `WorkflowId` or `TagId` comes only from its guard: `isStableName` (`compile/load-workflows.ts`), `isWorkflowId` and `isTagId` (`n8n/n8n-ids.ts`). A `StableTag` comes only from `stableTag()` (`deliver/stable-tag.ts`). The ban on type assertions leaves no other way to make one.

## Shape

- `compile/` reads and validates workflow files: the `defineWorkflow` types for the editor, and the loader that checks each export before deploy. It does no I/O: the files come in through `CommandContext.loadWorkflowFiles`. `isWorkflowFilePath` alone decides which paths are workflow files. Why typed exports: `docs/adr/0005-workflow-files-are-typed-n8n-exports.md`.
- `deliver/` is deploy: `plan-deploy.ts` reads and decides each workflow's action, `apply-plan.ts` runs the writes (`docs/adr/0004-deploy-plans-before-it-writes.md`). `deploy-failure.ts` holds `EFFECTS`, the one table that says which deploy errors stop the run and with which exit code.
- `connection/` is ping: the checks that `lift ping` runs.
- Shared folders: `config/` (connection config from env and `.env`), `n8n/` (the `N8nClient` port in `n8n.model.ts`, the id guards, what Boilerlift relies on in the public API in `n8n-api.ts`, and the shared fake), `common/` (what several folders use: every exit code in `exit-codes.ts`, `isRecord` in `is-record.ts`, `Result` in `result.ts`).
- Past the `N8nClient` port, the types are trusted: the adapter (`src/services/n8n/`) parses every body once. An `invalid-response` failure is treated like an unreachable instance (exit 3).
- Each folder holds its code, its tests and its `*.model.ts`.

## Tests

- Tests reach the instance through `fakeN8n().client` (`n8n/n8n.fake.ts`), the shared in-memory instance, never a real one and never a new stand-in.

## Example

- `src/core/deliver/plan-deploy.ts` and `src/core/deliver/deploy.test.ts`
