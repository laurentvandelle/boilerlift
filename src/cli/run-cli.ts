import { parseArgs } from 'node:util';
import { CliResult, CommandContext, CommandDefinition } from '#src/cli/cli.model';
import {
  GLOBAL_OPTIONS,
  commandOptions,
  renderCommandHelp,
  renderGlobalHelp,
  unknownCommand,
  usageError,
} from '#src/cli/commands/help/help.command';

/** Each global option, long and short, and the command it runs: `--version` and `-v` run version. */
const GLOBAL_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(GLOBAL_OPTIONS).flatMap(([name, { short }]): [string, string][] =>
    short === undefined ? [[`--${name}`, name]] : [[`--${name}`, name], [`-${short}`, name]],
  ),
);

export async function runCli(args: string[], ctx: CommandContext): Promise<CliResult> {
  const [first = '--help', ...rest] = args;
  const name = GLOBAL_ALIASES[first] ?? first;
  if (name.startsWith('-')) {
    return usageError(`Unknown option: ${name}`, renderGlobalHelp(ctx.registry));
  }
  const command = ctx.registry.find((candidate) => candidate.name === name);
  if (command === undefined) {
    return unknownCommand(name, ctx.registry);
  }
  return runCommand(command, rest, ctx);
}

async function runCommand(command: CommandDefinition, args: string[], ctx: CommandContext): Promise<CliResult> {
  try {
    const options = Object.fromEntries(
      Object.entries(commandOptions(command)).map(([name, { type, short }]) => [
        name,
        short === undefined ? { type } : { type, short },
      ]),
    );
    const { values, positionals } = parseArgs({ args, strict: true, allowPositionals: command.allowPositionals, options });
    if (values.help === true) {
      return { exitCode: 0, stdout: renderCommandHelp(command), stderr: '' };
    }
    return await command.run({ positionals, values }, ctx);
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error), renderCommandHelp(command));
  }
}
