import { describe, expect, test } from 'vitest';
import { FAKE_PROD_URL, fakeContext, fakeTwoTargets } from '#src/cli/cli.fake';
import { CliResult } from '#src/cli/cli.model';
import { defineCommand } from '#src/cli/define-command';
import { err, ok } from '#src/core/common/result';

const HELP = { exitCodes: [[0, 'Done']] } as const;
const NO_FLAGS = { positionals: [], values: {} };

function printed(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: '' };
}

/** A command whose output names the handler that ran, the prepared value, and the --json format value. */
const wayCommand = defineCommand({
  name: 'way',
  summary: 'Pick a way',
  help: HELP,
  allowPositionals: false,
  options: {
    left: { type: 'boolean', description: 'Go left', mode: true },
    json: { type: 'boolean', description: 'Print JSON', format: true },
  },
  needs: [],
  prepare: ({ options }) => Promise.resolve(options.flag('left') ? ok('map') : ok('compass')),
  modes: { left: (tool) => Promise.resolve(`left with ${tool}`) },
  default: (tool) => Promise.resolve(`straight with ${tool}`),
  render: (way, { format, mode }) => printed(`${way} (${mode}, json=${String(format.json)})`),
});

describe('defineCommand', () => {
  test('Should run default when no mode option is given', async () => {
    const result = await wayCommand.run(NO_FLAGS, fakeContext());

    expect(result).toEqual(printed('straight with compass (default, json=false)'));
  });

  test('Should run the handler of the mode option instead of default when its flag is given', async () => {
    const input = { positionals: [], values: { left: true } };

    const result = await wayCommand.run(input, fakeContext());

    expect(result).toEqual(printed('left with map (left, json=false)'));
  });

  test('Should give render the value of a format option when it is given', async () => {
    const input = { positionals: [], values: { json: true } };

    const result = await wayCommand.run(input, fakeContext());

    expect(result).toEqual(printed('straight with compass (default, json=true)'));
  });

  test('Should return the render of prepare and run no handler when prepare ends the command early', async () => {
    const ran: string[] = [];
    const command = defineCommand({
      name: 'early',
      summary: 'Stop early',
      help: HELP,
      allowPositionals: false,
      options: {},
      needs: [],
      prepare: () => Promise.resolve(err({ exitCode: 1, stdout: '', stderr: 'Nothing to do.\n' })),
      modes: {},
      default: () => {
        ran.push('default');
        return Promise.resolve('');
      },
      render: printed,
    });

    const result = await command.run(NO_FLAGS, fakeContext());

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'Nothing to do.\n' });
    expect(ran).toEqual([]);
  });

  test('Should exit 1 with the config error and call no handler when the command needs targets and there is no config file', async () => {
    const ran: string[] = [];
    const command = defineCommand({
      name: 'remote',
      summary: 'Reach n8n',
      help: HELP,
      allowPositionals: false,
      options: {},
      needs: ['targets'],
      modes: {},
      default: () => {
        ran.push('default');
        return Promise.resolve('');
      },
      render: printed,
    });

    const result = await command.run(NO_FLAGS, fakeContext());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('boilerlift.config.ts');
    expect(ran).toEqual([]);
  });

  test('Should print the config error as JSON when the command needs targets and its json format option is given', async () => {
    const command = defineCommand({
      name: 'remote',
      summary: 'Reach n8n',
      help: HELP,
      allowPositionals: false,
      options: { json: { type: 'boolean', description: 'Print JSON', format: true } },
      needs: ['targets'],
      modes: {},
      default: () => Promise.resolve(''),
      render: printed,
    });
    const input = { positionals: [], values: { json: true } };

    const result = await command.run(input, fakeContext());

    expect(JSON.parse(result.stdout)).toMatchObject({ error: { kind: 'no-config-file' }, availableTargets: [], exitCode: 1 });
  });

  test('Should hand the targets --target selects to the handler when the command needs targets', async () => {
    const command = defineCommand({
      name: 'remote',
      summary: 'Reach n8n',
      help: HELP,
      allowPositionals: false,
      options: {},
      needs: ['targets'],
      modes: {},
      default: (_prepared, { targets }) => Promise.resolve(targets.selected.map((target) => target.connection.url.value).join(',')),
      render: printed,
    });
    const input = { positionals: [], values: { target: 'prod' } };

    const result = await command.run(input, fakeContext({ loadProjectConfig: fakeTwoTargets() }));

    expect(result).toEqual(printed(FAKE_PROD_URL));
  });

  test('Should take the target options and no mode in the definition when the command needs targets', () => {
    const command = defineCommand({
      name: 'remote',
      summary: 'Reach n8n',
      help: HELP,
      allowPositionals: false,
      options: {},
      needs: ['targets'],
      modes: {},
      default: () => Promise.resolve(''),
      render: printed,
    });

    const { targets, modes } = command;

    expect({ targets, modes }).toEqual({ targets: true, modes: [] });
  });

  test('Should take no target option and no mode in the definition when the command declares neither', () => {
    const command = defineCommand({
      name: 'local',
      summary: 'Stay local',
      help: HELP,
      allowPositionals: false,
      options: { json: { type: 'boolean', description: 'Print JSON', format: true } },
      needs: ['version'],
      modes: {},
      default: (_prepared, { version }) => Promise.resolve(version),
      render: printed,
    });

    const { targets, modes } = command;

    expect({ targets, modes }).toEqual({ targets: false, modes: [] });
  });
});
