# AGENTS.md — src/cli

## Prohibitions

- A command never imports another command. It may import its own folder, `#src/cli/*.model.ts`, `define-command.ts`, `targets.render.ts`, `output.render.ts` and `core/`. Lint enforces this.
- A command does no I/O of its own (`src/AGENTS.md` lists what lint bans). `run` returns a `Promise<CliResult>`; `bin.ts` writes it. Anything a command needs from the outside world is a field of `CommandContext` (`cli.model.ts`, which documents each field), added by the first command that needs it and filled for the real process in `node-context.ts`, which only wires: the file adapters live in `services/fs/project-files.ts`.
- Only `targets-need.ts` and `node-context.ts` import `src/services/`. `targets-need.ts` builds the client of each target from `ctx.fetch` with `createN8nClient` (`services/n8n/n8n-client.ts`) for every command that declares the `'targets'` need; `node-context.ts` wires the file adapters of `services/fs/`. Commands and the rest of `cli/` never import it. Lint enforces this.

## Shape

- One folder per command: `commands/<name>/<name>.command.ts` exports `<name>Command: CommandDefinition`, built with `defineCommand` (`define-command.ts`), next to `<name>.command.test.ts`. A command of two words (`creds sync`) writes `<name>` with a dash: `creds-sync/creds-sync.command.ts`, `credsSyncCommand`. Dispatch matches the two words before a single one, and `lift help creds sync` takes both. Add `<name>.model.ts` only once the command has its own types.
- A definition reads top to bottom in the order it runs: `help` → `options` → `needs` → `prepare` → `modes` / `default` → `render`. Every field is required but `prepare`; write `options: {}` and `modes: {}` when there are none. The types follow the declarations (`define-command.test-d.ts` pins them):
  - `options`: each option has one role. A plain value is read with `input.options.flag()` / `text()`. `format: true` changes how the result prints and reaches `render` in `format`. `mode: true` picks the code to run: its handler, of the same name, is in `modes`. Do not branch on a mode flag inside a handler. Two mode flags at once are a usage error, rejected by dispatch. Every command also takes `-h, --help`, added by dispatch: never declare it.
  - `needs`: the context fields the command uses. The handlers get only those. `'targets'` resolves the targets `--target` and `--all` select, each with its client, in `targets-need.ts` (`SelectedTargets`: the project config and `selected`), or ends the command with the config error, exit 1 (as JSON too with a `json` format option). It also gives the command `--target`, `--all` and the targets section of its help.
  - `prepare`: the work every mode shares. An `err(render)` ends the command early.
  - `modes` and `default`: one handler per mode option, and the one that runs without a mode flag. They all return the same type, which `render` takes.
  - `render`: a function of `<name>.render.ts`, given the output and `{ format, mode, target, prepared, deps }`.
- Every command folder holds `<name>.render.ts`: the functions that turn what `core/` returns into the `CliResult` (marks, columns, wording, the `--json` payload, the stdout/stderr split). `<name>.command.ts` keeps the help, the options and the handlers, which call `core/`; `render` returns what a render function builds. A `stdout` or `stderr` property in a `*.command.ts` fails lint, and `registry.test.ts` fails when a registered command has no render file.
- Every human output follows `docs/output-style.md`: sections, rows, symbols and colour come from `output.render.ts`. Before writing the output of a new command, read it. No check enforces the style; the pinned output tests show a drift.
- `core/` may write sentences about the domain (`describeConfigError`, `CHECK_LABELS`, the `detail` and `hint` of an error). The layout, and any wording that depends on a CLI flag, stays in the render file. No check enforces this split.
- A command that runs on targets of `boilerlift.config.ts` declares the `'targets'` need: it then takes `--target` and `--all` (`TARGET_OPTIONS` in `commands/help/help.options.ts`) and reads the selection as `input.target`. Its handlers call the use case of its feature in `core/<feature>/` with `deps.targets.selected` and the ports it needs (call `checkWorkflowFolders`, `core/config/project-config.ts`, in `prepare` when it reads the folders). A command never reads the lock file or works out a business rule itself: it parses the options, asks the confirmation the use case calls for (`needs-confirmation`, with the confirmation rule of the use case), and renders. Its render file turns what the use case returns for each target into a `TargetRun`, and `render` lays them out with `renderTargets` (`targets.render.ts`); any other config error goes through `renderConfigError` there. Example: `commands/ping/`.
- Register every command in `registry.ts`. It is the only list of commands.
- `run-cli.ts` dispatches: the global options, command lookup, option parsing with `node:util` `parseArgs` from the command's `options`, `<command> --help`, the target options, before or after the command name (`--target` with `--all` is a usage error), and the rejection of two mode flags at once.
- Help is built by `commands/help/help.render.ts` from each definition: the usage line from its `name`, `help.positionals`, the target options and `options`, then the `summary`, `help.description`, the targets section (`TARGETS_HELP` in `targets.render.ts`, for a command that needs targets), the options, and `help.exitCodes`. `help.description` is prose: write no usage line, option, target setup or exit code in it. The global options live in one table, `GLOBAL_OPTIONS` in `commands/help/help.options.ts` (the command aliases `-h` and `-v`, then the target options), which dispatch and help both read. Do not write a list of commands or options by hand.
- CLI contracts live in `cli.model.ts`: `CliResult`, `CommandDefinition`, `CommandContext`, and the typed inputs `defineCommand` uses (`CommandSpec`, `CommandOption`, `CommandHelp`, `Deps`, `SelectedTargets`, `TypedCommandInput`, `RenderView`). Why modes and format: `docs/adr/0011-commands-declare-modes-format-and-needs.md`.

## Tests

- Await `<name>Command.run(input, ctx)` directly with a context from `fakeContext()` (`cli/cli.fake.ts`). Its `fetch` fails if called.
- A command test that reaches n8n sets `fetch: fakeN8n().fetch` (`core/n8n/n8n.fake.ts`): the shared in-memory instance, answering like the n8n public API. Do not write another fetch stand-in.
- Dispatch behavior is tested in `run-cli.test.ts`, with a fake command when the real ones do not cover the case. What `defineCommand` runs (needs, prepare, modes, format) is tested in `define-command.test.ts`, its types in `define-command.test-d.ts`.

## Example

- `src/cli/commands/help/help.command.ts` and `src/cli/commands/help/help.command.test.ts`
