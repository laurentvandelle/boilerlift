import { describe, expect, test } from 'vitest';
import { fakeContext, fakeSingleTarget, fakeTwoTargets } from '#src/cli/cli.fake';
import { CliResult, CommandContext, CommandDefinition } from '#src/cli/cli.model';
import { helpCommand } from '#src/cli/commands/help/help.command';
import { renderCommandHelp, renderGlobalHelp } from '#src/cli/commands/help/help.render';
import { versionCommand } from '#src/cli/commands/version/version.command';
import { defineCommand } from '#src/cli/define-command';
import { COMMANDS } from '#src/cli/registry';
import { crashResult, runCli } from '#src/cli/run-cli';

const echoCommand: CommandDefinition = defineCommand({
  name: 'echo',
  summary: 'Echo the parsed input',
  help: { exitCodes: [[0, 'The input is echoed']] },
  allowPositionals: false,
  options: {
    name: { type: 'string', short: 'n', description: 'Name to echo' },
    loud: { type: 'boolean', description: 'Shout' },
  },
  needs: [],
  modes: {},
  default: (_prepared, _deps, { options }) => Promise.resolve(`${String(options.text('name'))}${options.flag('loud') ? '!' : ''}`),
  render: (text) => ({ exitCode: 0, stdout: `${text}\n`, stderr: '' }),
});

/** A command with two mode options: each one runs its own handler. */
const pickCommand: CommandDefinition = defineCommand({
  name: 'pick',
  summary: 'Pick one way',
  help: { exitCodes: [[0, 'The way is picked']] },
  allowPositionals: false,
  options: {
    left: { type: 'boolean', description: 'Go left', mode: true },
    right: { type: 'boolean', description: 'Go right', mode: true },
  },
  needs: [],
  modes: { left: () => Promise.resolve('left'), right: () => Promise.resolve('right') },
  default: () => Promise.resolve('straight'),
  render: (way) => ({ exitCode: 0, stdout: `${way}\n`, stderr: '' }),
});

/** A command with a bug: it throws instead of returning a CliResult. */
const throwingCommand: CommandDefinition = defineCommand({
  name: 'boom',
  summary: 'Throw',
  help: { exitCodes: [[0, 'Never']] },
  allowPositionals: false,
  options: {},
  needs: [],
  modes: {},
  default: () => Promise.reject(new Error('EACCES: permission denied, scandir workflows')),
  render: (): CliResult => ({ exitCode: 0, stdout: '', stderr: '' }),
});

/** A command that runs on targets: it prints the selection runCli handed it, then the names of the targets it runs on. */
const targetCommand: CommandDefinition = defineCommand({
  name: 'aim',
  summary: 'Print the selected targets',
  help: { exitCodes: [[0, 'The targets are printed']] },
  allowPositionals: false,
  options: {},
  needs: ['targets'],
  modes: {},
  default: (_prepared, { targets }) => Promise.resolve(targets.selected.map(({ name }) => name).join(',')),
  render: (names, { target }) => ({ exitCode: 0, stdout: `${JSON.stringify(target)} ${names}\n`, stderr: '' }),
});

/** A command of two words, as `creds sync`, that runs on targets and prints its selection. */
const groupedCommand: CommandDefinition = defineCommand({
  name: 'pair up',
  summary: 'Pair the targets up',
  help: { exitCodes: [[0, 'Paired']] },
  allowPositionals: false,
  options: { loud: { type: 'boolean', description: 'Shout' } },
  needs: ['targets'],
  modes: {},
  default: (_prepared, { targets }, { options }) => Promise.resolve(`${targets.selected.map(({ name }) => name).join(',')}${options.flag('loud') ? '!' : ''}`),
  render: (names) => ({ exitCode: 0, stdout: `${names}\n`, stderr: '' }),
});

const ctx: CommandContext = fakeContext({
  version: '1.2.3',
  loadProjectConfig: fakeTwoTargets(),
  registry: [helpCommand, versionCommand, echoCommand, pickCommand, throwingCommand, targetCommand, groupedCommand],
});
const GLOBAL_HELP = renderGlobalHelp(ctx.registry);

describe('runCli', () => {
  test('Should list every command of the CLI when called with --help', async () => {
    const cli = fakeContext({ registry: COMMANDS });

    const result = await runCli(['--help'], cli);

    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `Usage: lift <command> [options]

Write n8n workflows in TypeScript, test them, and lift them from dev to prod.

Commands:
  help        Show help for Boilerlift or for one command
  version     Print the Boilerlift version
  ping        Check the connection to your n8n instance
  status      Show where each workflow stands on your n8n instance
  deploy      Deliver your workflows to your n8n instance as drafts
  creds sync  Write the credentials of your n8n instance to your project

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

  test('Should run the handler of the mode option when it is the only one given', async () => {
    const args = ['pick', '--right'];

    const result = await runCli(args, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: 'right\n', stderr: '' });
  });

  test('Should print the command help and fail when two mode options are given together', async () => {
    const args = ['pick', '--left', '--right'];

    const result = await runCli(args, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`--left and --right cannot be used together\n\n${renderCommandHelp(pickCommand)}`);
  });

  test('Should let the error reach the caller, not report a usage error, when a command throws', async () => {
    const run = runCli(['boom'], ctx);

    await expect(run).rejects.toThrow('EACCES: permission denied, scandir workflows');
  });
});

describe('crashResult', () => {
  test('Should exit 1 with the stack and without the help when an error escapes a command', () => {
    const error = new Error('EACCES: permission denied, scandir workflows');

    const result = crashResult(error);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${error.stack ?? ''}\n`);
    expect(result.stderr).toContain('Error: EACCES: permission denied, scandir workflows\n    at ');
    expect(result.stderr).not.toContain('Usage:');
  });

  test('Should print the value when something other than an Error is thrown', () => {
    const result = crashResult('plain string');

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'plain string\n' });
  });

  test('Should exit 1 with a usage error when --target and --all are given together', async () => {
    const result = await runCli(['aim', '--target', 'prod', '--all'], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--target and --all cannot be used together');
  });

  test('Should pass the named target to the command when --target follows the command name', async () => {
    const result = await runCli(['aim', '-t', 'prod'], ctx);

    expect(result.stdout).toBe('{"kind":"one","name":"prod"} prod\n');
  });

  test('Should pass the target options to the command when they come before the command name', async () => {
    const result = await runCli(['--target', 'prod', 'aim'], ctx);

    expect(result.stdout).toBe('{"kind":"one","name":"prod"} prod\n');
  });

  test('Should select every target when --all is given', async () => {
    const result = await runCli(['--all', 'aim'], ctx);

    expect(result.stdout).toBe('{"kind":"all"} dev,prod\n');
  });

  test('Should select the default target when neither --target nor --all is given', async () => {
    const single = fakeContext({ registry: ctx.registry, loadProjectConfig: fakeSingleTarget() });

    const result = await runCli(['aim'], single);

    expect(result.stdout).toBe('{"kind":"default"} dev\n');
  });

  test('Should reject --target as an unknown option when the command runs on no target', async () => {
    const result = await runCli(['version', '--target', 'prod'], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown option '--target'");
  });

  test('Should list the target options in the help of a command when it runs on targets', async () => {
    const result = await runCli(['aim', '--help'], ctx);

    expect(result.stdout).toContain('-t, --target <name>  Run on this target of boilerlift.config.ts');
  });

  test('Should run a command of two words with its options when both words are given', async () => {
    const result = await runCli(['pair', 'up', '--target', 'prod', '--loud'], ctx);

    expect(result.stdout).toBe('prod!\n');
  });

  test('Should take the target options before a command of two words when they lead', async () => {
    const result = await runCli(['--target', 'dev', 'pair', 'up'], ctx);

    expect(result.stdout).toBe('dev\n');
  });

  test('Should name both words as an unknown command when the second word is not a command of the group', async () => {
    const result = await runCli(['pair', 'down'], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command: pair down');
  });
});
