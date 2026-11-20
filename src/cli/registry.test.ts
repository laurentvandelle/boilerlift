import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { COMMANDS } from '#src/cli/registry';

describe('COMMANDS', () => {
  test.each(COMMANDS.map(({ name }) => name.replaceAll(' ', '-')))(
    'Should keep the command and its render file in commands/%s when it is registered',
    (name) => {
      const folder = join(__dirname, 'commands', name);

      const files = [`${name}.command.ts`, `${name}.render.ts`].filter((file) => existsSync(join(folder, file)));

      expect(files).toEqual([`${name}.command.ts`, `${name}.render.ts`]);
    },
  );
});
