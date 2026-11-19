---
status: accepted
---

# Commands declare their modes, format options and needs

A command is built by `defineCommand` from layers read in the order they run: `help` → `options` → `needs` → `prepare` → `modes` / `default` → `render`. Each option has one role. A **mode** option (`--dry-run`) picks the code that runs, and its handler, of the same name, sits in `modes`, next to `default`. A **format** option (`--json`) changes only how the result prints and reaches `render`. Any other option is a plain value. A command lists the context it uses in `needs` and receives only those fields. `'targets'` is one of them: `cli/targets-need.ts` resolves the targets of `boilerlift.config.ts` that `--target` and `--all` select (ADR 0010) and builds the client of each, so the commands no longer import `services/` (this amends ADR-0007). The goal: reading one command file shows what each option runs and what the command depends on.

## Considered options

- **One handler per option.** Every option carries its own `run`. Rejected: flags that combine (`--dry-run --json`) need a handler per combination, two flags given at once need a hidden precedence rule, the setup every path shares is copied into each handler, and value options such as `--json` have no code of their own to run.
- **The handler inside the option** (`'dry-run': { mode: handler }`). This was the first design, but TypeScript cannot infer what `prepare` returns while it reads the options object, so the handler's parameters would need hand-written types. The handlers live in `modes`, keyed by the option name.

## Consequences

- Two mode flags at once are a usage error (exit 1), rejected by dispatch.
- The usage line, the targets section (from `needs`) and the option table of the help are generated. A command writes only its description and exit codes.
- The command types are not narrowed at runtime: a handler that reaches past its declared needs fails to compile, and `targets` throws if it is read without being declared.
