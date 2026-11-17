import { CliResult, CommandDefinition, CommandOption } from '#src/cli/cli.model';
import { EXIT_USAGE } from '#src/core/exit/exit-codes';

const HELP_OPTION: CommandOption = { type: 'boolean', short: 'h', description: 'Show this help' };

/** The options n8nlift takes in place of a command. Each one runs the command of its name: `n8nlift -v` runs version. */
export const GLOBAL_OPTIONS: Readonly<Record<string, CommandOption>> = {
  help: HELP_OPTION,
  version: { type: 'boolean', short: 'v', description: 'Print the n8nlift version' },
};

export const helpCommand: CommandDefinition = {
  name: 'help',
  summary: 'Show help for n8nlift or for one command',
  usage: 'n8nlift help [command]',
  allowPositionals: true,
  options: {},
  run: ({ positionals }, ctx) => Promise.resolve(renderHelp(positionals, ctx.registry)),
};

function renderHelp(positionals: string[], registry: readonly CommandDefinition[]): CliResult {
  const [target] = positionals;
  if (target === undefined) {
    return { exitCode: 0, stdout: renderGlobalHelp(registry), stderr: '' };
  }
  const command = registry.find((candidate) => candidate.name === target);
  if (command === undefined) {
    return unknownCommand(target, registry);
  }
  return { exitCode: 0, stdout: renderCommandHelp(command), stderr: '' };
}

/** The options a command takes: its own, then `-h, --help`. */
export function commandOptions(command: CommandDefinition): Record<string, CommandOption> {
  return { ...command.options, help: HELP_OPTION };
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
  const commands = table(registry.map((command) => [command.name, command.summary]));
  const options = table(optionRows(GLOBAL_OPTIONS));
  return `Usage: n8nlift <command> [options]

Write n8n workflows in TypeScript, test them, and lift them from dev to prod.

Commands:
${commands}
Options:
${options}
Run \`n8nlift help <command>\` for the options of one command.
`;
}

export function renderCommandHelp(command: CommandDefinition): string {
  const options = table(optionRows(commandOptions(command)));
  return `Usage: ${command.usage}

${command.summary}

Options:
${options}`;
}

function optionRows(options: Readonly<Record<string, CommandOption>>): string[][] {
  return Object.entries(options).map(([name, option]) => {
    const flag = option.short === undefined ? `    --${name}` : `-${option.short}, --${name}`;
    const value = option.type === 'string' ? ` <${name}>` : '';
    return [`${flag}${value}`, option.description];
  });
}

function table(rows: string[][]): string {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}\n`).join('');
}
