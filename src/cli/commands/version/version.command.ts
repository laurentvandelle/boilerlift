import { CommandDefinition } from '#src/cli/cli.model';
import { defineCommand } from '#src/cli/define-command';
import { EXIT_OK } from '#src/core/exit/exit-codes';

export const versionCommand: CommandDefinition = defineCommand({
  name: 'version',
  summary: 'Print the n8nlift version',
  usage: 'n8nlift version',
  allowPositionals: false,
  options: {},
  run: (_input, ctx) => Promise.resolve({ exitCode: EXIT_OK, stdout: `${ctx.version}\n`, stderr: '' }),
});
