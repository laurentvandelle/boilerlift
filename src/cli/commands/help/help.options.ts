import { CommandDefinition, CommandOption } from '#src/cli/cli.model';

const HELP_OPTION: CommandOption = { type: 'boolean', short: 'h', description: 'Show this help' };

/** The options Boilerlift takes in place of a command. Each one runs the command of its name: `lift -v` runs version. */
export const COMMAND_ALIAS_OPTIONS: Readonly<Record<string, CommandOption>> = {
  help: HELP_OPTION,
  version: { type: 'boolean', short: 'v', description: 'Print the Boilerlift version' },
};

/**
 * The options that choose the targets of boilerlift.config.ts a command runs on. Every command that runs on targets
 * takes them, after its name or before it: `lift deploy -t prod`, `lift --all ping`.
 */
export const TARGET_OPTIONS: Readonly<Record<string, CommandOption>> = {
  target: { type: 'string', short: 't', valueName: 'name', description: 'Run on this target of boilerlift.config.ts' },
  all: { type: 'boolean', description: 'Run on every target, in the order boilerlift.config.ts declares them' },
};

/** Every global option: the command aliases, then the target options. */
export const GLOBAL_OPTIONS: Readonly<Record<string, CommandOption>> = { ...COMMAND_ALIAS_OPTIONS, ...TARGET_OPTIONS };

/** The options a command takes: its own, the target options when it runs on targets, then `-h, --help`. */
export function commandOptions(command: CommandDefinition): Readonly<Record<string, CommandOption>> {
  return { ...command.options, ...(command.targets ? TARGET_OPTIONS : {}), help: HELP_OPTION };
}
