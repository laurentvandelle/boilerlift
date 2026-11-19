import { parseArgs } from 'node:util';
import { CliResult, CommandContext, CommandDefinition, CommandInput, CommandOption } from '#src/cli/cli.model';
import { COMMAND_ALIAS_OPTIONS, TARGET_OPTIONS, commandOptions } from '#src/cli/commands/help/help.options';
import { renderCommandHelp, renderGlobalHelp, renderHelp, unknownCommand, usageError } from '#src/cli/commands/help/help.render';
import { EXIT_UNEXPECTED } from '#src/core/common/exit-codes';
import { Result, err, ok } from '#src/core/common/result';

/** Each command alias option, long and short, and the command it runs: `--version` and `-v` run version. */
const GLOBAL_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(COMMAND_ALIAS_OPTIONS).flatMap(([name, { short }]): [string, string][] =>
    short === undefined ? [[`--${name}`, name]] : [[`--${name}`, name], [`-${short}`, name]],
  ),
);

export async function runCli(args: string[], ctx: CommandContext): Promise<CliResult> {
  const { leading, others } = splitLeadingTargetOptions(args);
  const [first = '--help', ...afterName] = others;
  const rest = [...afterName, ...leading];
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
 * The target options written before the command name (`lift --target prod deploy`), moved out so the command parses
 * them with its own. A string option takes the next argument as its value, unless written `--target=prod`.
 */
function splitLeadingTargetOptions(args: string[]): { leading: string[]; others: string[] } {
  const leading: string[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? '';
    const option = targetOptionOf(arg);
    if (option === undefined) {
      break;
    }
    const takesValue = option.type === 'string' && !arg.includes('=');
    leading.push(...args.slice(index, index + (takesValue ? 2 : 1)));
    index += takesValue ? 2 : 1;
  }
  return { leading, others: args.slice(index) };
}

function targetOptionOf(arg: string): CommandOption | undefined {
  const [flag = ''] = arg.split('=');
  return Object.entries(TARGET_OPTIONS).find(([name, { short }]) => flag === `--${name}` || (short !== undefined && flag === `-${short}`))?.[1];
}

/**
 * Parses the options of `command`, then runs it. Only a parse error, `--target` with `--all`, or two mode options at
 * once is a usage error. An error the command throws is a bug or a broken environment: it reaches bin.ts, which
 * reports it with crashResult.
 */
async function runCommand(command: CommandDefinition, args: string[], ctx: CommandContext): Promise<CliResult> {
  const input = parseInput(command, args);
  if (!input.ok) {
    return usageError(input.error, renderCommandHelp(command));
  }
  if (input.value.values.help === true) {
    return renderHelp(renderCommandHelp(command));
  }
  if (command.targets && input.value.values.target !== undefined && input.value.values.all === true) {
    return usageError('--target and --all cannot be used together: name one target, or run on every one.', renderCommandHelp(command));
  }
  const modes = command.modes.filter((name) => input.value.values[name] === true);
  if (modes.length > 1) {
    return usageError(`${modes.map((name) => `--${name}`).join(' and ')} cannot be used together`, renderCommandHelp(command));
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
