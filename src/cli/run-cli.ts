import { parseArgs } from 'node:util';
import { CliResult, CommandContext, CommandDefinition, CommandInput } from '#src/cli/cli.model';
import {
  GLOBAL_OPTIONS,
  commandOptions,
  renderCommandHelp,
  renderGlobalHelp,
  unknownCommand,
  usageError,
} from '#src/cli/commands/help/help.command';
import { EXIT_OK, EXIT_UNEXPECTED } from '#src/core/exit/exit-codes';
import { Result, err, ok } from '#src/core/result/result';

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

/**
 * Parses the options of `command`, then runs it. Only a parse error is a usage error. An error the command throws is
 * a bug or a broken environment: it reaches bin.ts, which reports it with crashResult.
 */
async function runCommand(command: CommandDefinition, args: string[], ctx: CommandContext): Promise<CliResult> {
  const input = parseInput(command, args);
  if (!input.ok) {
    return usageError(input.error, renderCommandHelp(command));
  }
  if (input.value.values.help === true) {
    return { exitCode: EXIT_OK, stdout: renderCommandHelp(command), stderr: '' };
  }
  return command.run(input.value, ctx);
}

/** The positionals and option values of `args`, or the parse error message. */
function parseInput(command: CommandDefinition, args: string[]): Result<CommandInput, string> {
  const options = Object.fromEntries(
    Object.entries(commandOptions(command)).map(([name, { type, short }]) => [
      name,
      short === undefined ? { type } : { type, short },
    ]),
  );
  try {
    const { values, positionals } = parseArgs({ args, strict: true, allowPositionals: command.allowPositionals, options });
    return ok({ positionals, values });
  } catch (error) {
    if (isParseError(error)) {
      return err(error.message);
    }
    throw error;
  }
}

/** `parseArgs` throws a TypeError whose `code` starts with `ERR_PARSE_ARGS_` for arguments that do not match. */
function isParseError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS_');
}

/** What bin.ts prints for an error that escaped a command: its stack, without the help. */
export function crashResult(error: unknown): CliResult {
  const text = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  return { exitCode: EXIT_UNEXPECTED, stdout: '', stderr: `${text}\n` };
}
