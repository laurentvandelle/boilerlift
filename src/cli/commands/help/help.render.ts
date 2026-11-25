import { CliResult, CommandDefinition, CommandOption } from '#src/cli/cli.model';
import { GLOBAL_OPTIONS, commandOptions } from '#src/cli/commands/help/help.options';
import { TARGETS_HELP } from '#src/cli/targets.render';
import { EXIT_OK, EXIT_USAGE } from '#src/cli/exit-codes';

/** A help text on stdout, exit 0. */
export function renderHelp(help: string): CliResult {
  return { exitCode: EXIT_OK, stdout: help, stderr: '' };
}

/** A usage error: exit 1, with the reason, then the help, on stderr. */
export function usageError(reason: string, help: string): CliResult {
  return { exitCode: EXIT_USAGE, stdout: '', stderr: `${reason}\n\n${help}` };
}

/** The usage error for a name that no registered command has, with the global help. */
export function unknownCommand(name: string, registry: readonly CommandDefinition[]): CliResult {
  return usageError(`Unknown command: ${name}`, renderGlobalHelp(registry));
}

export function renderGlobalHelp(registry: readonly CommandDefinition[]): string {
  const commands = table(registry.map((command): Row => [command.name, command.summary]));
  const options = table(optionRows(GLOBAL_OPTIONS));
  return `Usage: lift <command> [options]

Write n8n workflows in TypeScript, test them, and lift them from dev to prod.

Commands:
${commands}
Options:
${options}
Run \`lift help <command>\` for the options of one command.
\`boilerlift\` is an alias of \`lift\`.
`;
}

/**
 * The help of one command, built from its definition: the usage line (from its name, positionals and options), the
 * summary, the description, how it picks its targets (when it needs them), its options with `-h, --help`, and its exit
 * codes.
 */
export function renderCommandHelp(command: CommandDefinition): string {
  const sections = [
    `Usage: ${usageLine(command)}`,
    command.summary,
    ...(command.help.description === undefined ? [] : [command.help.description]),
    ...(command.targets ? [TARGETS_HELP] : []),
    `Options:\n${table(optionRows(commandOptions(command)))}`,
    `Exit codes:\n${table(command.help.exitCodes.map(([code, meaning]): Row => [String(code), meaning]))}${
      command.targets ? 'With --all, the exit code is the highest of the targets.\n' : ''
    }`,
  ];
  return sections.map((section) => section.replace(/\n$/, '')).join('\n\n') + '\n';
}

/**
 * `lift <name> [positionals] [--target <name> | --all] [--flag] [--text <text>]`, from the declared options and the
 * target options when the command needs targets; `--help` is left out.
 */
function usageLine(command: CommandDefinition): string {
  const options = Object.entries(command.options).map(([name, option]) =>
    option.type === 'string' ? `[--${name} <${option.valueName ?? name}>]` : `[--${name}]`,
  );
  return [
    'lift',
    command.name,
    ...(command.help.positionals === undefined ? [] : [command.help.positionals]),
    ...(command.targets ? ['[--target <name> | --all]'] : []),
    ...options,
  ].join(' ');
}

/** One line of a help table: the left column, then its description. */
type Row = [string, string];

function optionRows(options: Readonly<Record<string, CommandOption>>): Row[] {
  return Object.entries(options).map(([name, option]): Row => {
    const flag = option.short === undefined ? `    --${name}` : `-${option.short}, --${name}`;
    const value = option.type === 'string' ? ` <${option.valueName ?? name}>` : '';
    return [`${flag}${value}`, option.description];
  });
}

function table(rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}\n`).join('');
}
