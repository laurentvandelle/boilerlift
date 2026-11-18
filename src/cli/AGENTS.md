# AGENTS.md — src/cli

## Prohibitions

- A command never imports another command. It may import its own folder, `#src/cli/*.model.ts`, `define-command.ts`, `targets.render.ts` and `core/`. Lint enforces this.
- A command does no I/O of its own (`src/AGENTS.md` lists what lint bans). `run` returns a `Promise<CliResult>`; `bin.ts` writes it. Anything a command needs from the outside world is a field of `CommandContext` (`cli.model.ts`, which documents each field), added by the first command that needs it and filled for the real process in `node-context.ts`.
- Only the commands import `src/services/`: a command builds the client from `ctx.fetch` with `createN8nClient` (`services/n8n/n8n-client.ts`). The rest of `cli/` never imports it. Lint enforces this.

## Shape

- One folder per command: `commands/<name>/<name>.command.ts` exports `<name>Command: CommandDefinition`, built with `defineCommand` (`define-command.ts`), next to `<name>.command.test.ts`. `defineCommand` types the option values by the declared `options`: `options.flag('dry-run')` compiles only when the command declares a boolean `dry-run`. Add `<name>.model.ts` only once the command has its own types.
- Every command folder holds `<name>.render.ts`: the functions that turn what `core/` returns into the `CliResult` (marks, columns, wording, the `--json` payload, the stdout/stderr split). `<name>.command.ts` keeps the usage, the options and `run`, which calls `core/` and returns what a render function builds. A `stdout` or `stderr` property in a `*.command.ts` fails lint, and `registry.test.ts` fails when a registered command has no render file.
- `core/` may write sentences about the domain (`describeConfigError`, `CHECK_LABELS`, the `detail` and `hint` of an error). The layout, and any wording that depends on a CLI flag, stays in the render file. No check enforces this split.
- A command that runs on targets of `boilerlift.config.ts` sets `targets: true`: it then takes `--target` and `--all` (`TARGET_OPTIONS` in `commands/help/help.options.ts`) and reads the selection as `input.target`. It resolves the targets with `targetsToRun` (`core/config/project-config.ts`, with `checkWorkflowFolders` when it reads the folders), its render file turns each target into a `TargetRun`, and `renderTargets` (`targets.render.ts`) lays them out; a config error goes through `renderConfigError` there. Example: `commands/ping/`.
- Register every command in `registry.ts`. It is the only list of commands.
- `run-cli.ts` dispatches: the global options, command lookup, option parsing with `node:util` `parseArgs` from the command's `options`, `<command> --help`, and the target options, before or after the command name (`--target` with `--all` is a usage error).
- Help is built by `commands/help/help.render.ts` from each definition's `summary`, `usage` and `options`. `usage` may hold the command's long help, exit codes included. The global options live in one table, `GLOBAL_OPTIONS` in `commands/help/help.options.ts` (the command aliases `-h` and `-v`, then the target options), which dispatch and help both read. Do not write a list of commands or options by hand.
- CLI contracts live in `cli.model.ts`: `CliResult`, `CommandDefinition`, `CommandContext`, and the typed inputs `defineCommand` uses (`CommandSpec`, `TypedCommandInput`, `OptionValues`).

## Tests

- Await `<name>Command.run(input, ctx)` directly with a context from `fakeContext()` (`cli/cli.fake.ts`). Its `fetch` fails if called.
- A command test that reaches n8n sets `fetch: fakeN8n().fetch` (`core/n8n/n8n.fake.ts`): the shared in-memory instance, answering like the n8n public API. Do not write another fetch stand-in.
- Dispatch behavior is tested in `run-cli.test.ts`, with a fake command when the real ones do not cover the case.

## Example

- `src/cli/commands/help/help.command.ts` and `src/cli/commands/help/help.command.test.ts`
