import { assertType, describe, test } from 'vitest';
import { CliResult, CommandDefinition } from '#src/cli/cli.model';
import { defineCommand } from '#src/cli/define-command';

const DONE: Promise<CliResult> = Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });

const OPTIONS = {
  'dry-run': { type: 'boolean', description: 'Write nothing' },
  tag: { type: 'string', description: 'A tag' },
} as const;

describe('defineCommand', () => {
  test('Should type each option by its declaration when run reads it', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'typed',
        summary: 'Typed options',
        usage: 'n8nlift typed',
        allowPositionals: false,
        options: OPTIONS,
        run: ({ options }) => {
          assertType<boolean>(options.flag('dry-run'));
          assertType<string | undefined>(options.text('tag'));
          return DONE;
        },
      }),
    );
  });

  test('Should reject an option name when the command does not declare it with that type', () => {
    assertType<CommandDefinition>(
      defineCommand({
        name: 'typed',
        summary: 'Typed options',
        usage: 'n8nlift typed',
        allowPositionals: false,
        options: OPTIONS,
        run: ({ options }) => {
        // @ts-expect-error 'dryrun' is not a declared option
          options.flag('dryrun');
          // @ts-expect-error 'tag' is a string option, not a flag
          options.flag('tag');
          // @ts-expect-error 'dry-run' is a boolean option, not a string
          options.text('dry-run');
          return DONE;
        },
      }),
    );
  });
});
