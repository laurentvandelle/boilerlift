import { describe, expect, test } from 'vitest';
import { fakeContext, fakeProjectFolder } from '#src/cli/cli.fake';
import { initCommand } from '#src/cli/commands/init/init.command';

const URL = 'https://github.com/laurentvandelle/boilerlift-template.git';

const TEMPLATE = [
  { path: 'README.md', text: '# Project\n' },
  { path: '.gitignore', text: '.env\n' },
  { path: 'package.json', text: '{ "boilerlift": "^1.4.2" }\n' },
];

describe('initCommand', () => {
  test('Should create every file of the template, sorted, then print the next steps when the folder is missing', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    const result = await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext(folder.context));

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        '✓ .gitignore',
        '✓ package.json',
        '✓ README.md',
        '',
        'The project is not ready yet. Run these commands, in order, to finish the setup:',
        '→ cd my-app',
        '→ git init',
        '→ npm install',
        '→ cp .env.example .env, then fill in N8N_URL and N8N_API_KEY',
        '→ npx lift ping',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('Should fetch the Project template of the running version when it creates the project', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext({ ...folder.context, version: '1.4.2' }));

    expect(folder.fetches).toEqual(['1.4.2']);
  });

  test('Should write each file of the template into the folder, as is, when it creates the project', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    await initCommand.run({ positionals: ['my-app/'], values: {} }, fakeContext(folder.context));

    expect([folder.text('my-app/.gitignore'), folder.text('my-app/package.json')]).toEqual(['.env\n', '{ "boilerlift": "^1.4.2" }\n']);
  });

  test('Should create the project when the folder exists and is empty', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, contents: { kind: 'folder', entries: [] } });

    const result = await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, folder.text('my-app/README.md')]).toEqual([0, '# Project\n']);
  });

  test('Should write the files beside .git and leave git init out of the next steps when the folder holds only .git', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, contents: { kind: 'folder', entries: ['.git'] } });

    const result = await initCommand.run({ positionals: ['my-app'], values: { json: true } }, fakeContext(folder.context));

    expect([folder.text('my-app/README.md'), JSON.parse(result.stdout)]).toEqual([
      '# Project\n',
      expect.objectContaining({ next: ['cd my-app', 'npm install', 'cp .env.example .env, then fill in N8N_URL and N8N_API_KEY', 'npx lift ping'] }),
    ]);
  });

  test('Should leave cd out of the next steps when the folder is the current one', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, contents: { kind: 'folder', entries: [] } });

    const result = await initCommand.run({ positionals: ['.'], values: { json: true } }, fakeContext(folder.context));

    expect([folder.text('README.md'), JSON.parse(result.stdout)]).toEqual([
      '# Project\n',
      expect.objectContaining({ next: ['git init', 'npm install', 'cp .env.example .env, then fill in N8N_URL and N8N_API_KEY', 'npx lift ping'] }),
    ]);
  });

  test('Should exit 1, fetch nothing and write nothing when the folder holds anything but .git', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, contents: { kind: 'folder', entries: ['.git', 'workflows'] } });

    const result = await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext(folder.context));

    expect([result, folder.fetches, folder.writes]).toEqual([
      {
        exitCode: 1,
        stdout: '',
        stderr: [
          'Cannot create a project in my-app: the folder is not empty.',
          '  → Name a new or empty folder, for example lift init my-workflows.',
          '  → To bring an existing project to a new version, see https://github.com/laurentvandelle/boilerlift/blob/main/docs/migration.md',
          '',
        ].join('\n'),
      },
      [],
      [],
    ]);
  });

  test('Should exit 1 and write nothing, linking the migration guide, when the folder given is an existing file', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, contents: { kind: 'file' } });

    const result = await initCommand.run({ positionals: ['notes.txt'], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, result.stderr.split('\n')[0], result.stderr.includes('docs/migration.md'), folder.writes]).toEqual([
      1,
      'Cannot create a project in notes.txt: it is a file, not a folder.',
      true,
      [],
    ]);
  });

  test('Should exit 1 and write nothing when no folder is given', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    const result = await initCommand.run({ positionals: [], values: {} }, fakeContext(folder.context));

    expect([result, folder.fetches, folder.writes]).toEqual([
      {
        exitCode: 1,
        stdout: '',
        stderr: 'lift init needs a folder to create the project in.\n  → Name a new or empty folder, for example lift init my-workflows.\n',
      },
      [],
      [],
    ]);
  });

  test('Should exit 1 and write nothing when two folders are given', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    const result = await initCommand.run({ positionals: ['a', 'b'], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, folder.writes]).toEqual([1, []]);
  });

  test('Should exit 13, write nothing and say how to install git when git is not found', async () => {
    const folder = fakeProjectFolder({ fetchError: { kind: 'git-not-found', url: URL } });

    const result = await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext(folder.context));

    expect([result, folder.writes]).toEqual([
      {
        exitCode: 13,
        stdout: '',
        stderr: [
          `Cannot get the Project template from ${URL}: git not found.`,
          '  → Install git (https://git-scm.com/downloads), then run lift init again.',
          '',
        ].join('\n'),
      },
      [],
    ]);
  });

  test('Should exit 13, write nothing and name the missing tag when the template has no tag for this version', async () => {
    const folder = fakeProjectFolder({ fetchError: { kind: 'tag-not-found', url: URL, tag: 'v1.4.2' } });

    const result = await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, result.stderr, folder.writes]).toEqual([
      13,
      [
        `Cannot get the Project template from ${URL}: it has no tag v1.4.2, the tag of this version of lift.`,
        '  → Run a released version of lift, for example npx boilerlift@latest init my-app',
        '',
      ].join('\n'),
      [],
    ]);
  });

  test('Should exit 13, write nothing and give the reason of git when the clone fails', async () => {
    const folder = fakeProjectFolder({ fetchError: { kind: 'fetch-failed', url: URL, tag: 'v1.4.2', reason: 'Could not resolve host: github.com' } });

    const result = await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, result.stderr.split('\n')[0], folder.writes]).toEqual([
      13,
      `Cannot get the Project template v1.4.2 from ${URL}: Could not resolve host: github.com`,
      [],
    ]);
  });

  test('Should print the error and exit 13 as JSON when the template cannot be fetched and --json is given', async () => {
    const folder = fakeProjectFolder({ fetchError: { kind: 'git-not-found', url: URL } });

    const result = await initCommand.run({ positionals: ['my-app'], values: { json: true } }, fakeContext(folder.context));

    expect(JSON.parse(result.stdout)).toEqual({
      error: { kind: 'git-not-found', message: `Cannot get the Project template from ${URL}: git not found.` },
      exitCode: 13,
    });
  });

  test('Should keep writing the other files, mark the failed one and exit 12 when a write fails', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, failures: { 'my-app/package.json': 'EACCES: permission denied' } });

    const result = await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, result.stdout.split('\n')[1], result.stderr, folder.text('my-app/README.md')]).toEqual([
      12,
      '✗ package.json  EACCES: permission denied',
      '1 of 3 files could not be written.\n\n→ Fix the cause, then run lift init again in a new or empty folder\n',
      '# Project\n',
    ]);
  });

  test('Should report a file as failed, not overwrite it, when one appears in the folder during the writes', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, existing: ['my-app/README.md'] });

    const result = await initCommand.run({ positionals: ['my-app'], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, result.stdout.split('\n')[2], folder.text('my-app/README.md')]).toEqual([
      12,
      '✗ README.md     a file is already there',
      undefined,
    ]);
  });

  test('Should print the folder, the files, the next steps and the exit code as JSON when --json is given', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, failures: { 'my-app/README.md': 'disk full' } });

    const result = await initCommand.run({ positionals: ['my-app'], values: { json: true } }, fakeContext(folder.context));

    expect(JSON.parse(result.stdout)).toEqual({
      folder: 'my-app',
      files: [
        { path: '.gitignore', status: 'created' },
        { path: 'package.json', status: 'created' },
        { path: 'README.md', status: 'failed', reason: 'disk full' },
      ],
      next: ['cd my-app', 'git init', 'npm install', 'cp .env.example .env, then fill in N8N_URL and N8N_API_KEY', 'npx lift ping'],
      exitCode: 12,
    });
  });
});
