import { assertType, describe, test } from 'vitest';
import { CliResult, CommandDefinition, SelectedTargets } from '#src/cli/cli.model';
import { defineCommand } from '#src/cli/define-command';

const PRINTED: CliResult = { exitCode: 0, stdout: '', stderr: '' };
const HELP = { exitCodes: [[0, 'Done']] } as const;

const OPTIONS = {
  'dry-run': { type: 'boolean', description: 'Write nothing', mode: true },
  json: { type: 'boolean', description: 'Print JSON', format: true },
  tag: { type: 'string', description: 'A tag' },
} as const;

describe('defineCommand', () => {
  test('Should type each option by its declaration when a handler reads it', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'typed',
        summary: 'Typed options',
        help: HELP,
        allowPositionals: false,
        options: OPTIONS,
        needs: [],
        modes: { 'dry-run': () => Promise.resolve(0) },
        default: (_prepared, _deps, { options, mode }) => {
          assertType<boolean>(options.flag('dry-run'));
          assertType<string | undefined>(options.text('tag'));
          assertType<'dry-run' | 'default'>(mode);
          return Promise.resolve(0);
        },
        render: () => PRINTED,
      }),
    );
  });

  test('Should reject an option name when the command does not declare it with that type', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'typed',
        summary: 'Typed options',
        help: HELP,
        allowPositionals: false,
        options: OPTIONS,
        needs: [],
        modes: { 'dry-run': () => Promise.resolve(0) },
        default: (_prepared, _deps, { options }) => {
          // @ts-expect-error 'dryrun' is not a declared option
          options.flag('dryrun');
          // @ts-expect-error 'tag' is a string option, not a flag
          options.flag('tag');
          // @ts-expect-error 'dry-run' is a boolean option, not a string
          options.text('dry-run');
          return Promise.resolve(0);
        },
        render: () => PRINTED,
      }),
    );
  });

  test('Should give render only the format options when the command declares some', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'format',
        summary: 'Format options',
        help: HELP,
        allowPositionals: false,
        options: OPTIONS,
        needs: [],
        modes: { 'dry-run': () => Promise.resolve(0) },
        default: () => Promise.resolve(0),
        render: (_output, { format }) => {
          assertType<boolean>(format.json);
          // @ts-expect-error 'tag' is not a format option
          assertType<unknown>(format.tag);
          return PRINTED;
        },
      }),
    );
  });

  test('Should give the handlers only the declared needs, with the targets resolved, when the command declares them', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'needs',
        summary: 'Declared needs',
        help: HELP,
        allowPositionals: false,
        options: {},
        needs: ['targets', 'nodeVersion'],
        modes: {},
        default: (_prepared, deps) => {
          assertType<SelectedTargets>(deps.targets);
          assertType<string>(deps.nodeVersion);
          // @ts-expect-error 'fetch' is not a declared need
          assertType<unknown>(deps.fetch);
          return Promise.resolve(0);
        },
        render: () => PRINTED,
      }),
    );
  });

  test('Should pass what prepare returns to every handler and to render when the command prepares', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'prepared',
        summary: 'Prepared value',
        help: HELP,
        allowPositionals: false,
        options: OPTIONS,
        needs: [],
        prepare: () => Promise.resolve({ ok: true, value: ['a', 'b'] }),
        modes: { 'dry-run': (names) => Promise.resolve(names.length) },
        default: (names) => Promise.resolve(names.length),
        render: (count, { prepared }) => {
          assertType<number>(count);
          assertType<string[]>(prepared);
          return PRINTED;
        },
      }),
    );
  });

  test('Should reject a mode when its handler is missing or returns another type than default', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'missing',
        summary: 'Missing mode',
        help: HELP,
        allowPositionals: false,
        options: OPTIONS,
        needs: [],
        // @ts-expect-error the 'dry-run' mode option has no handler
        modes: {},
        default: () => Promise.resolve(0),
        render: () => PRINTED,
      }),
    );
    assertType<CommandDefinition>(
      defineCommand({
        name: 'mismatch',
        summary: 'Mismatched mode',
        help: HELP,
        allowPositionals: false,
        options: OPTIONS,
        needs: [],
        // @ts-expect-error the mode returns a string, default a number
        modes: { 'dry-run': () => Promise.resolve('zero') },
        default: () => Promise.resolve(0),
        render: () => PRINTED,
      }),
    );
  });

  test('Should reject an option when it is both a mode and a format', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'both',
        summary: 'Both roles',
        help: HELP,
        allowPositionals: false,
        // @ts-expect-error an option picks the code to run or changes how it prints, not both
        options: { both: { type: 'boolean', description: 'Both', mode: true, format: true } },
        needs: [],
        modes: {},
        default: () => Promise.resolve(0),
        render: () => PRINTED,
      }),
    );
  });
});
