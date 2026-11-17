import { CliResult, CommandDefinition } from '#src/cli/cli.model';
import { renderCommandHelp, renderGlobalHelp, renderHelp, unknownCommand } from '#src/cli/commands/help/help.render';
import { defineCommand } from '#src/cli/define-command';

export const helpCommand: CommandDefinition = defineCommand({
  name: 'help',
  summary: 'Show help for n8nlift or for one command',
  usage: 'n8nlift help [command]',
  allowPositionals: true,
  options: {},
  run: ({ positionals }, ctx) => Promise.resolve(help(positionals, ctx.registry)),
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
