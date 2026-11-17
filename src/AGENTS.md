# AGENTS.md — src

## Prohibitions

- Do not import from `debug/` or `dist/`.
- Layer direction: `cli` → `services` → `core`. `core` never imports `cli` or `services`, tests included. Only `cli/commands/` import `services/`. `npm run lint:check` (`eslint-plugin-boundaries`) enforces it.
- `bin.ts` imports only from `cli/`. `index.ts` imports only from `core/compile/`; the CLI is not a public API. Lint enforces both.
- `core/`, `services/` and `cli/commands/` take configuration, I/O, time and randomness through their parameters (`CommandContext`, the `N8nClient` port, an injected `fetch`), so a test controls them: no `process`, `console` or global `fetch`, no `node:fs`, `node:http` or other file, network or process module, no `Date.now()`, `new Date()`, `Math.random()` or `randomUUID()`. Lint enforces it. Tests and fakes are exempt.
- Strict types: no `any`, no type assertion but `as const`, no non-null `!`, and a `switch` over a union handles every member. Check an unknown object with `isRecord` (`core/common/is-record.ts`), never with an inline `typeof x === 'object'`. Lint enforces all of these.
- Write the minimum versions only through their constants: `MIN_NODE_VERSION` and `MIN_NODE_VERSION_SHORT` (`core/connection/check-connection.ts`), `MIN_N8N_VERSION` (`core/n8n/n8n-api.ts`). A version retyped in a message drifts at the next bump. No check enforces this.

## Shape

- `bin.ts` is the executable: it hands `process.argv` and `nodeContext(process.cwd())` (`cli/node-context.ts`) to `runCli`, then writes the `CliResult`. An error that escapes a command reaches it and exits 1 with its stack.
- `index.ts` is the package entry point: what workflow files import from `'boilerlift'` (`defineWorkflow` and the workflow types). Everything it exports is public API.
- Imports across folders use the `#src/` alias (`#src/cli/cli.model`). Relative imports fail lint. Node.js resolves the alias at runtime through `package.json` `imports` (`#src/*` → `./dist/*.js`). `tsconfig.json` `paths` maps it to `src/` for type-checking and lint, and `vitest.config.mts` maps it in tests. The alias must start with `#`: Node.js rejects other prefixes such as `@/`.
- Type files are named `*.model.ts` and hold types only.
- Exported functions declare their return type (`@typescript-eslint/explicit-function-return-type`). Lint enforces it: `lint:check` fails on warnings.

## Errors and states

- An expected failure is returned, never thrown: the function returns the one `Result<T, E>` of `core/common/result.ts` (`ok`, `err`), and the caller checks it. Do not add another result shape. Error objects are tagged by `kind`. A throw is for a bug or a broken environment only: it reaches `bin.ts`, which prints the stack and exits 1. No check enforces this. Why: `docs/adr/0006-expected-failures-are-returned-results.md`.
- Write `Result<T, E>` in full where it is used, as in `Result<ConnectionConfig, ConfigError>`. Do not alias it (`type ConfigResult = Result<…>`): the signature then shows both the value and the error. Lint enforces it.
- A value with several states is a union keyed by one field (`action`, `status`, `kind`), each member carrying only its own fields, not a flag plus optional fields. Examples: `PlannedStep` and `DeployResult` (`core/deliver/deploy.model.ts`), `Check` (`core/connection/connection.model.ts`). No check enforces the shape; lint makes every `switch` over it exhaustive.

## Example

- `src/cli/commands/version/version.command.ts` and `src/cli/commands/version/version.command.test.ts`
