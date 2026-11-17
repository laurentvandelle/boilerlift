import { describe, expect, test } from 'vitest';
import { fakeContext } from '#src/cli/cli.fake';
import { CommandContext, CommandDefinition } from '#src/cli/cli.model';
import { helpCommand, renderCommandHelp, renderGlobalHelp } from '#src/cli/commands/help/help.command';
import { versionCommand } from '#src/cli/commands/version/version.command';
import { COMMANDS } from '#src/cli/registry';
import { runCli } from '#src/cli/run-cli';

const echoCommand: CommandDefinition = {
  name: 'echo',
  summary: 'Echo the parsed input',
  usage: 'n8nlift echo [options]',
  allowPositionals: false,
  options: {
    name: { type: 'string', short: 'n', description: 'Name to echo' },
    loud: { type: 'boolean', description: 'Shout' },
  },
  run: ({ values }) =>
    Promise.resolve({ exitCode: 0, stdout: `${String(values.name)}${values.loud === true ? '!' : ''}\n`, stderr: '' }),
};

const ctx: CommandContext = fakeContext({ version: '1.2.3', registry: [helpCommand, versionCommand, echoCommand] });
const GLOBAL_HELP = renderGlobalHelp(ctx.registry);

describe('runCli', () => {
  test('Should list every command of the CLI when called with --help', async () => {
    const cli = fakeContext({ registry: COMMANDS });

    const result = await runCli(['--help'], cli);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `Usage: n8nlift <command> [options]

Write n8n workflows in TypeScript, test them, and lift them from dev to prod.

Commands:
  help     Show help for n8nlift or for one command
  version  Print the n8nlift version
  ping     Check the connection to your n8n instance
  deploy   Deliver your workflows to your n8n instance as drafts

Options:
  -h, --help     Show this help
  -v, --version  Print the n8nlift version

Run \`n8nlift help <command>\` for the options of one command.
`,
    });
  });

  test.each([['--version'], ['-v'], ['version']])('Should print the version when called with %s', async (arg) => {
    const args = [arg];

    const result = await runCli(args, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: '1.2.3\n', stderr: '' });
  });

  test.each([['--help'], ['-h'], ['help']])('Should print the global help when called with %s', async (arg) => {
    const args = [arg];

    const result = await runCli(args, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: GLOBAL_HELP, stderr: '' });
  });

  test('Should print the global help when called without arguments', async () => {
    const args: string[] = [];

    const result = await runCli(args, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: GLOBAL_HELP, stderr: '' });
  });

  test('Should print the help of a command when called with --help after it', async () => {
    const args = ['version', '--help'];

    const result = await runCli(args, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: renderCommandHelp(versionCommand), stderr: '' });
  });

  test('Should pass an option to the command when it is given by its short alias', async () => {
    const args = ['echo', '-n', 'lift'];

    const result = await runCli(args, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: 'lift\n', stderr: '' });
  });

  test('Should pass the options to the command when they are given by their long names', async () => {
    const args = ['echo', '--name', 'lift', '--loud'];

    const result = await runCli(args, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: 'lift!\n', stderr: '' });
  });

  test('Should print the global help and fail when the command is unknown', async () => {
    const args = ['foo'];

    const result = await runCli(args, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown command: foo');
    expect(result.stderr).toContain(GLOBAL_HELP);
  });

  test('Should print the global help and fail when the global option is unknown', async () => {
    const args = ['--nope'];

    const result = await runCli(args, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown option: --nope');
    expect(result.stderr).toContain(GLOBAL_HELP);
  });

  test('Should print the command help and fail when a command option is unknown', async () => {
    const args = ['echo', '--nope'];

    const result = await runCli(args, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(renderCommandHelp(echoCommand));
  });

  test('Should fail when a command that takes no arguments gets one', async () => {
    const args = ['version', 'extra'];

    const result = await runCli(args, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(renderCommandHelp(versionCommand));
  });
});
