import { CliResult, CommandDefinition, CommandOption } from '#src/cli/cli.model';
import { GLOBAL_OPTIONS, commandOptions } from '#src/cli/commands/help/help.options';
import { EXIT_OK, EXIT_USAGE } from '#src/core/common/exit-codes';

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

export function renderCommandHelp(command: CommandDefinition): string {
  const options = table(optionRows(commandOptions(command)));
  return `Usage: ${command.usage}

${command.summary}

Options:
${options}`;
}

/** One line of a help table: the left column, then its description. */
type Row = [string, string];

function optionRows(options: Readonly<Record<string, CommandOption>>): Row[] {
  return Object.entries(options).map(([name, option]): Row => {
    const flag = option.short === undefined ? `    --${name}` : `-${option.short}, --${name}`;
    const value = option.type === 'string' ? ` <${name}>` : '';
    return [`${flag}${value}`, option.description];
  });
}

function table(rows: Row[]): string {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}\n`).join('');
}
