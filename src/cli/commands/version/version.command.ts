import { CommandDefinition } from '#src/cli/cli.model';
import { renderVersion } from '#src/cli/commands/version/version.render';
import { defineCommand } from '#src/cli/define-command';

export const versionCommand: CommandDefinition = defineCommand({
  name: 'version',
  summary: 'Print the Boilerlift version',
  usage: 'lift version',
  allowPositionals: false,
  targets: false,
  options: {},
  run: (_input, ctx) => Promise.resolve(renderVersion(ctx.version)),
});
