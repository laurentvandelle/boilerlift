import { describe, expect, test } from 'vitest';
import { fakeContext, fakeProjectFolder } from '#src/cli/cli.fake';
import { initCommand } from '#src/cli/commands/init/init.command';

const TEMPLATE = [
  { path: '_gitignore', text: '.env\n' },
  { path: 'package.json', text: '{ "boilerlift": "^{{boilerliftVersion}}" }\n' },
  { path: 'README.md', text: '# Project\n' },
];

const AGENT_TEMPLATE = [
  { path: '.claude/hooks/guard.ts', text: '// hook\n' },
  { path: '.claude/settings.json', text: '{}\n' },
];

describe('initCommand', () => {
  test('Should create every file of the template, then print the next steps, when the folder is empty', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    const result = await initCommand.run({ positionals: [], values: {} }, fakeContext(folder.context));

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        '✓ .gitignore',
        '✓ package.json',
        '✓ README.md',
        '',
        'The project is not ready yet. Run these commands, in order, to finish the setup:',
        '→ npm install',
        '→ cp .env.example .env, then fill in N8N_URL and N8N_API_KEY',
        '→ npx lift ping',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('Should write the template _gitignore as .gitignore when it creates the project', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    await initCommand.run({ positionals: [], values: {} }, fakeContext(folder.context));

    expect([folder.text('.gitignore'), folder.text('_gitignore')]).toEqual(['.env\n', undefined]);
  });

  test('Should write the Boilerlift version into package.json when it creates the project', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    await initCommand.run({ positionals: [], values: {} }, fakeContext({ ...folder.context, version: '1.4.2' }));

    expect(folder.text('package.json')).toBe('{ "boilerlift": "^1.4.2" }\n');
  });

  test('Should write into the folder and start the next steps with cd when a folder is given', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    const result = await initCommand.run({ positionals: ['my-app/'], values: {} }, fakeContext(folder.context));

    expect([folder.text('my-app/README.md'), result.stdout.split('\n')[5]]).toEqual(['# Project\n', '→ cd my-app/']);
  });

  test('Should leave an existing file untouched and report it as skipped when the folder holds part of a project', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, existing: ['README.md'] });

    const result = await initCommand.run({ positionals: [], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, folder.text('README.md'), result.stdout.split('\n')[2]]).toEqual([
      0,
      undefined,
      '– README.md (already there, left as it is)',
    ]);
  });

  test('Should keep the existing Claude Code settings, still create the hook, and say how to add the hook when .claude/settings.json is already there', async () => {
    const folder = fakeProjectFolder({ template: AGENT_TEMPLATE, existing: ['.claude/settings.json'] });

    const result = await initCommand.run({ positionals: [], values: { json: true } }, fakeContext(folder.context));

    expect([folder.text('.claude/settings.json'), folder.text('.claude/hooks/guard.ts'), JSON.parse(result.stdout)]).toEqual([
      undefined,
      '// hook\n',
      expect.objectContaining({ next: [
        'npm install',
        'cp .env.example .env, then fill in N8N_URL and N8N_API_KEY',
        '.claude/settings.json was already there: to guard the agent, add this entry to its "hooks" → "PreToolUse" list: ' +
          '{ "matcher": "Bash|Read|Grep", "hooks": [{ "type": "command", "command": "node --disable-warning=ExperimentalWarning \\"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.ts\\"" }] }',
        'npx lift ping',
      ] }),
    ]);
  });

  test('Should print no hook step when init creates .claude/settings.json itself', async () => {
    const folder = fakeProjectFolder({ template: AGENT_TEMPLATE });

    const result = await initCommand.run({ positionals: [], values: {} }, fakeContext(folder.context));

    expect(result.stdout.includes('PreToolUse')).toBe(false);
  });

  test('Should keep writing the other files, mark the failed one and exit 12 when a write fails', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, failures: { 'package.json': 'EACCES: permission denied' } });

    const result = await initCommand.run({ positionals: [], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, result.stdout.split('\n')[1], result.stderr, folder.text('README.md')]).toEqual([
      12,
      '✗ package.json: EACCES: permission denied',
      '1 of 3 files could not be written. Run lift init again to write them.\n',
      '# Project\n',
    ]);
  });

  test('Should print the files, the next steps and the exit code as JSON when --json is given', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE, existing: ['.gitignore'], failures: { 'README.md': 'disk full' } });

    const result = await initCommand.run({ positionals: [], values: { json: true } }, fakeContext(folder.context));

    expect(JSON.parse(result.stdout)).toEqual({
      folder: '.',
      files: [
        { path: '.gitignore', status: 'skipped' },
        { path: 'package.json', status: 'created' },
        { path: 'README.md', status: 'failed', reason: 'disk full' },
      ],
      next: ['npm install', 'cp .env.example .env, then fill in N8N_URL and N8N_API_KEY', 'npx lift ping'],
      exitCode: 12,
    });
  });

  test('Should exit 1 and write nothing when the folder given is an existing file', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    const result = await initCommand.run(
      { positionals: ['notes.txt'], values: {} },
      fakeContext({ ...folder.context, isFile: (path) => Promise.resolve(path === 'notes.txt') }),
    );

    expect([result, folder.text('notes.txt/README.md')]).toEqual([
      {
        exitCode: 1,
        stdout: '',
        stderr: 'Cannot start a project in notes.txt: it is a file, not a folder.\n  → Name a new or existing folder, for example lift init my-workflows.\n',
      },
      undefined,
    ]);
  });

  test('Should exit 1 and write nothing when two folders are given', async () => {
    const folder = fakeProjectFolder({ template: TEMPLATE });

    const result = await initCommand.run({ positionals: ['a', 'b'], values: {} }, fakeContext(folder.context));

    expect([result.exitCode, folder.text('a/README.md')]).toEqual([1, undefined]);
  });
});
