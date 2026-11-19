import {
  CliResult,
  CommandContext,
  CommandDefinition,
  CommandHelp,
  CommandInput,
  CommandOption,
  CommandSpec,
  NeedName,
  NeedSources,
  OptionValues,
  TargetSelection,
} from '#src/cli/cli.model';
import { resolveTargets } from '#src/cli/targets-need';
import { Result, ok } from '#src/core/common/result';

/**
 * Builds a command from its layers, read top to bottom in the order they run:
 * `help` → `options` → `needs` → `prepare` → `modes` / `default` → `render`.
 *
 * The types follow the declarations: `input.options.flag('dry-run')` compiles only when the command declares a boolean
 * `dry-run`, `deps` holds only the declared `needs`, `modes` holds one handler per `mode: true` option, every handler
 * returns what `render` takes, and `format` holds the `format: true` options. The registry keeps the erased
 * `CommandDefinition`.
 */
export function defineCommand<
  const Options extends Readonly<Record<string, CommandOption>>,
  Output,
  const Needs extends NeedName = never,
  Prepared = undefined,
>(spec: CommandSpec<Options, Needs, Prepared, Output>): CommandDefinition;
export function defineCommand(spec: ErasedSpec): CommandDefinition {
  const needsTargets = spec.needs.some((need) => need === 'targets');
  const modes = Object.entries(spec.options).flatMap(([name, option]) => (option.mode === true ? [name] : []));
  return {
    name: spec.name,
    summary: spec.summary,
    help: spec.help,
    allowPositionals: spec.allowPositionals,
    targets: needsTargets,
    options: spec.options,
    modes,
    run: async (raw, ctx): Promise<CliResult> => {
      const input = typedInput(raw, spec.options, modes, needsTargets);
      const deps = await needSources(ctx, needsTargets, input);
      if (!deps.ok) {
        return deps.error;
      }
      const prepared = spec.prepare === undefined ? ok(undefined) : await spec.prepare(input, deps.value);
      if (!prepared.ok) {
        return prepared.error;
      }
      const handler = input.mode === 'default' ? spec.default : spec.modes?.[input.mode];
      if (handler === undefined) {
        throw new Error(`The mode option --${input.mode} of ${spec.name} has no handler in modes`);
      }
      const output = await handler(prepared.value, deps.value, input);
      const { format, mode, target } = input;
      return spec.render(output, { format, mode, target, prepared: prepared.value, deps: deps.value });
    },
  };
}

/** The spec as the implementation sees it, its types erased. The overload above keeps them for each command. */
interface ErasedSpec {
  name: string;
  summary: string;
  help: CommandHelp;
  allowPositionals: boolean;
  options: Readonly<Record<string, CommandOption>>;
  needs: readonly NeedName[];
  prepare?: (input: ErasedInput, deps: NeedSources) => Promise<Result<unknown, CliResult>>;
  default: ErasedHandler;
  modes?: Readonly<Record<string, ErasedHandler>>;
  render: (output: unknown, view: ErasedView) => CliResult;
}

type ErasedHandler = (prepared: unknown, deps: NeedSources, input: ErasedInput) => Promise<unknown>;

type FormatRecord = Readonly<Record<string, string | boolean | undefined>>;

interface ErasedInput {
  positionals: string[];
  options: OptionValues<Readonly<Record<string, CommandOption>>>;
  format: FormatRecord;
  mode: string;
  target: TargetSelection;
}

interface ErasedView {
  format: FormatRecord;
  mode: string;
  target: TargetSelection;
  prepared: unknown;
  deps: NeedSources;
}

/**
 * The needs, resolved. The command reads only the ones it declares: the types hide the others. `targets` is resolved
 * only when declared, so a command without it never reads the project config.
 */
async function needSources(ctx: CommandContext, needsTargets: boolean, input: ErasedInput): Promise<Result<NeedSources, CliResult>> {
  if (!needsTargets) {
    return ok({
      ...ctx,
      get targets(): never {
        throw new Error("This command reads targets without declaring 'targets' in its needs");
      },
    });
  }
  const targets = await resolveTargets(ctx, input.target, input.format.json === true);
  return targets.ok ? ok({ ...ctx, targets: targets.value }) : targets;
}

/**
 * The parsed values, read by type, the `format: true` values, the mode option given (or `'default'`), and the targets
 * `--target` and `--all` select.
 */
function typedInput(
  raw: CommandInput,
  options: Readonly<Record<string, CommandOption>>,
  modes: readonly string[],
  needsTargets: boolean,
): ErasedInput {
  const { values } = raw;
  const format = Object.fromEntries(
    Object.entries(options).flatMap(([name, option]) =>
      option.format === true ? [[name, option.type === 'boolean' ? values[name] === true : textOf(values[name])]] : [],
    ),
  );
  return {
    positionals: raw.positionals,
    options: {
      flag: (name): boolean => values[name] === true,
      text: (name): string | undefined => textOf(values[name]),
    },
    format,
    mode: modes.find((name) => values[name] === true) ?? 'default',
    target: needsTargets ? targetSelection(values) : { kind: 'default' },
  };
}

/** The targets `--target <name>` and `--all` select; runCli rejects the two together before a command runs. */
function targetSelection(values: CommandInput['values']): TargetSelection {
  const name = values.target;
  if (typeof name === 'string') {
    return { kind: 'one', name };
  }
  return values.all === true ? { kind: 'all' } : { kind: 'default' };
}

function textOf(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
