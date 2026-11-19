import { describe, expect, test } from 'vitest';
import { fakeContext } from '#src/cli/cli.fake';
import { CommandContext, CommandDefinition } from '#src/cli/cli.model';
import { helpCommand } from '#src/cli/commands/help/help.command';

const fakeCommand: CommandDefinition = {
  name: 'fake',
  summary: 'Do fake things',
  help: { description: 'Goes where you say.', exitCodes: [[0, 'Arrived']] },
  allowPositionals: false,
  targets: true,
  options: { place: { type: 'string', short: 'p', description: 'Where to go' } },
  modes: [],
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

  test('Should print the usage line, description, targets, options and exit codes of one command when called with its name', async () => {
    const input = { positionals: ['fake'], values: {} };

    const result = await helpCommand.run(input, ctx);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `Usage: lift fake [--target <name> | --all] [--place <place>]

Do fake things

Goes where you say.

Targets (declared in ./boilerlift.config.ts):
  url     Root URL of the n8n instance (Boilerlift adds /api/v1)
  apiKey  Its n8n API key (n8n → Settings → n8n API). Read it from the environment in the
          file, for example process.env.N8N_API_KEY: the variables of ./.env are loaded
          first, and a variable already set in the environment wins.
With one target declared, the command runs on it. With several, name one with --target,
or run on every one in turn with --all.

Options:
  -p, --place <place>  Where to go
  -t, --target <name>  Run on this target of boilerlift.config.ts
      --all            Run on every target, in the order boilerlift.config.ts declares them
  -h, --help           Show this help

Exit codes:
  0  Arrived
With --all, the exit code is the highest of the targets.
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
