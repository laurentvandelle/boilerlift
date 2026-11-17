import { describe, expect, test } from 'vitest';
import { fakeContext } from '#src/cli/cli.fake';
import { versionCommand } from '#src/cli/commands/version/version.command';

describe('versionCommand', () => {
  test('Should print the version from the context when called', async () => {
    const ctx = fakeContext({ version: '1.2.3', registry: [versionCommand] });

    const result = await versionCommand.run({ positionals: [], values: {} }, ctx);

    expect(result).toEqual({ exitCode: 0, stdout: '1.2.3\n', stderr: '' });
  });
});
