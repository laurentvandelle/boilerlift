import { CliResult, CommandDefinition } from '#src/cli/cli.model';
import { renderCommandHelp, renderGlobalHelp, renderHelp, unknownCommand } from '#src/cli/commands/help/help.render';
import { defineCommand } from '#src/cli/define-command';
import { EXIT_OK, EXIT_USAGE } from '#src/core/common/exit-codes';

export const helpCommand: CommandDefinition = defineCommand({
  name: 'help',
  summary: 'Show help for Boilerlift or for one command',
  help: {
    positionals: '[command]',
    exitCodes: [
      [EXIT_OK, 'The help is printed'],
      [EXIT_USAGE, 'Unknown command'],
    ],
  },
  allowPositionals: true,
  options: {},
  needs: ['registry'],
  modes: {},
  default: (_prepared, { registry }, { positionals }) => Promise.resolve(help(positionals, registry)),
  render: (result) => result,
});

function help(positionals: string[], registry: readonly CommandDefinition[]): CliResult {
  const [target] = positionals;
  if (target === undefined) {
    return renderHelp(renderGlobalHelp(registry));
  }
  const command = registry.find((candidate) => candidate.name === target);
  if (command === undefined) {
    return unknownCommand(target, registry);
  }
  return renderHelp(renderCommandHelp(command));
}
