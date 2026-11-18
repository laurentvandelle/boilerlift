import { describe, expect, test } from 'vitest';
import { fakeContext } from '#src/cli/cli.fake';
import { CommandContext, CommandDefinition } from '#src/cli/cli.model';
import { helpCommand } from '#src/cli/commands/help/help.command';

const fakeCommand: CommandDefinition = {
  name: 'fake',
  summary: 'Do fake things',
  usage: 'lift fake [options]',
  allowPositionals: false,
  targets: false,
  options: { target: { type: 'string', short: 't', description: 'Where to go' } },
  run: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
};

const ctx: CommandContext = fakeContext({ version: '1.2.3', registry: [helpCommand, fakeCommand] });

describe('helpCommand', () => {
  test('Should list every registered command when called without a target', async () => {
    const input = { positionals: [], values: {} };

    const result = await helpCommand.run(input, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `Usage: lift <command> [options]

Write n8n workflows in TypeScript, test them, and lift them from dev to prod.

Commands:
  help  Show help for Boilerlift or for one command
  fake  Do fake things

Options:
  -h, --help           Show this help
  -v, --version        Print the Boilerlift version
  -t, --target <name>  Run on this target of boilerlift.config.ts
      --all            Run on every target, in the order boilerlift.config.ts declares them

Run \`lift help <command>\` for the options of one command.
\`boilerlift\` is an alias of \`lift\`.
`,
    });
  });

  test('Should print the help of one command when called with its name', async () => {
    const input = { positionals: ['fake'], values: {} };

    const result = await helpCommand.run(input, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `Usage: lift fake [options]

Do fake things

Options:
  -t, --target <target>  Where to go
  -h, --help             Show this help
`,
    });
  });

  test('Should fail when the target command is unknown', async () => {
    const input = { positionals: ['nope'], values: {} };

    const result = await helpCommand.run(input, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command: nope');
  });
});
