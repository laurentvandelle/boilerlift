import { CommandDefinition, CommandInput, CommandOption, CommandSpec, OptionValues } from '#src/cli/cli.model';

/**
 * A command whose `run` reads its options by their declared names and types: `options.flag('dry-run')` compiles only
 * when the command declares a boolean `dry-run`. The registry keeps the erased `CommandDefinition`.
 */
export function defineCommand<const Options extends Readonly<Record<string, CommandOption>>>(
  spec: CommandSpec<Options>,
): CommandDefinition {
  return {
    name: spec.name,
    summary: spec.summary,
    usage: spec.usage,
    allowPositionals: spec.allowPositionals,
    options: spec.options,
    run: (input, ctx) => spec.run({ positionals: input.positionals, options: optionValues(input.values) }, ctx),
  };
}

/** Narrows each parsed value by the type the reader asks for: a flag is true only when given. */
function optionValues<Options>(values: CommandInput['values']): OptionValues<Options> {
  return {
    flag: (name): boolean => values[name] === true,
    text: (name): string | undefined => {
      const value = values[name];
      return typeof value === 'string' ? value : undefined;
    },
  };
}
