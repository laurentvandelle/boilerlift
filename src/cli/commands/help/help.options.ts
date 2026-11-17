import { CommandDefinition, CommandOption } from '#src/cli/cli.model';

const HELP_OPTION: CommandOption = { type: 'boolean', short: 'h', description: 'Show this help' };

/** The options n8nlift takes in place of a command. Each one runs the command of its name: `n8nlift -v` runs version. */
export const GLOBAL_OPTIONS: Readonly<Record<string, CommandOption>> = {
  help: HELP_OPTION,
  version: { type: 'boolean', short: 'v', description: 'Print the n8nlift version' },
};

/** The options a command takes: its own, then `-h, --help`. */
export function commandOptions(command: CommandDefinition): Readonly<Record<string, CommandOption>> {
  return { ...command.options, help: HELP_OPTION };
}
