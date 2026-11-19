import { CommandDefinition } from '#src/cli/cli.model';
import { renderVersion } from '#src/cli/commands/version/version.render';
import { defineCommand } from '#src/cli/define-command';
import { EXIT_OK, EXIT_USAGE } from '#src/core/common/exit-codes';

export const versionCommand: CommandDefinition = defineCommand({
  name: 'version',
  summary: 'Print the Boilerlift version',
  help: {
    exitCodes: [
      [EXIT_OK, 'The version is printed'],
      [EXIT_USAGE, 'Usage error'],
    ],
  },
  allowPositionals: false,
  options: {},
  needs: ['version'],
  modes: {},
  default: (_prepared, { version }) => Promise.resolve(version),
  render: renderVersion,
});
