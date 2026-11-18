import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, onTestFinished, test } from 'vitest';
import { nodeContext } from '#src/cli/node-context';

const WORKFLOW = { name: 'Invoice sync', nodes: [], connections: {} };

/** A new empty folder in the system temp folder, deleted when the test ends. */
async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'boilerlift-node-context-'));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

/** Writes `content` to `path` under `folder`, creating the folders on the way. */
async function write(folder: string, path: string, content: string): Promise<void> {
  const file = join(folder, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

describe('nodeContext', () => {
  test('Should hold the text of .env when the folder has one', async () => {
    const cwd = await tempFolder();
    await write(cwd, '.env', 'N8N_URL=https://n8n.example.com\n');

    const ctx = nodeContext(cwd);

    expect(ctx.dotEnv).toBe('N8N_URL=https://n8n.example.com\n');
  });

  test('Should leave dotEnv undefined when the folder has no .env', async () => {
    const cwd = await tempFolder();

    const ctx = nodeContext(cwd);

    expect(ctx.dotEnv).toBeUndefined();
  });

  test('Should take the version from the package.json of boilerlift when it builds the context', async () => {
    const cwd = await tempFolder();

    const ctx = nodeContext(cwd);

    expect(ctx.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('nodeContext loadWorkflowFiles', () => {
  test('Should read the files of every subfolder, sorted, with paths from the folder when the workflows are nested', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'workflows/zeta.json', JSON.stringify(WORKFLOW));
    await write(cwd, 'workflows/crm/import.json', JSON.stringify(WORKFLOW));
    await write(cwd, 'workflows/billing/invoice.workflow.ts', `const workflow: object = ${JSON.stringify(WORKFLOW)};\nexport default workflow;\n`);

    const files = await nodeContext(cwd).loadWorkflowFiles('workflows');

    expect(files).toEqual([
      { path: 'workflows/billing/invoice.workflow.ts', content: WORKFLOW },
      { path: 'workflows/crm/import.json', content: WORKFLOW },
      { path: 'workflows/zeta.json', content: WORKFLOW },
    ]);
  });

  test('Should skip every file under node_modules when the folder holds one', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'workflows/a.json', JSON.stringify(WORKFLOW));
    await write(cwd, 'workflows/node_modules/some-package/package.json', '{"name":"some-package"}');
    await write(cwd, 'workflows/crm/node_modules/b.json', JSON.stringify(WORKFLOW));

    const files = await nodeContext(cwd).loadWorkflowFiles('workflows');

    expect(files.map((file) => file.path)).toEqual(['workflows/a.json']);
  });

  test('Should skip the other files when the folder holds files that are neither .workflow.ts nor .json', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'workflows/a.json', JSON.stringify(WORKFLOW));
    await write(cwd, 'workflows/notes.md', '# Notes\n');
    await write(cwd, 'workflows/helper.ts', 'export const helper = 1;\n');

    const files = await nodeContext(cwd).loadWorkflowFiles('workflows');

    expect(files.map((file) => file.path)).toEqual(['workflows/a.json']);
  });

  test('Should return the parse error of that file and read the others when a JSON file is invalid', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'workflows/a.json', JSON.stringify(WORKFLOW));
    await write(cwd, 'workflows/broken.json', '');

    const files = await nodeContext(cwd).loadWorkflowFiles('workflows');

    expect(files).toEqual([
      { path: 'workflows/a.json', content: WORKFLOW },
      { path: 'workflows/broken.json', error: 'Unexpected end of JSON input' },
    ]);
  });

  test('Should return the error of that file when a .workflow.ts file throws on import', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'workflows/throws.workflow.ts', "throw new Error('boom');\n");

    const files = await nodeContext(cwd).loadWorkflowFiles('workflows');

    expect(files).toEqual([{ path: 'workflows/throws.workflow.ts', error: 'boom' }]);
  });

  test('Should resolve [] when the folder does not exist', async () => {
    const cwd = await tempFolder();

    const files = await nodeContext(cwd).loadWorkflowFiles('workflows');

    expect(files).toEqual([]);
  });

  test('Should reject when the folder cannot be read for another reason than being missing', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'workflows', 'a file, not a folder');

    const loading = nodeContext(cwd).loadWorkflowFiles('workflows');

    await expect(loading).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});

describe('nodeContext lock file', () => {
  test('Should read the text of the lock file when the folder has one', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'boilerlift.lock.json', '{"version":1,"instances":{}}\n');

    const text = await nodeContext(cwd).readLockFile('boilerlift.lock.json');

    expect(text).toBe('{"version":1,"instances":{}}\n');
  });

  test('Should read undefined when the folder has no lock file', async () => {
    const cwd = await tempFolder();

    const text = await nodeContext(cwd).readLockFile('boilerlift.lock.json');

    expect(text).toBeUndefined();
  });

  test('Should write the whole lock file under the folder when it writes the lock file', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'boilerlift.lock.json', 'old text that is longer than the new one\n');

    const written = await nodeContext(cwd).writeLockFile('boilerlift.lock.json', '{}\n');

    expect({ written, text: await readFile(join(cwd, 'boilerlift.lock.json'), 'utf8') }).toEqual({ written: { ok: true, value: undefined }, text: '{}\n' });
  });

  test('Should return the reason when the lock file cannot be written', async () => {
    const cwd = await tempFolder();
    await mkdir(join(cwd, 'boilerlift.lock.json'));

    const written = await nodeContext(cwd).writeLockFile('boilerlift.lock.json', '{}\n');

    expect({ ok: written.ok, namesTheFile: !written.ok && written.error.reason.includes('boilerlift.lock.json') }).toEqual({
      ok: false,
      namesTheFile: true,
    });
  });
});

describe('nodeContext project config', () => {
  test('Should return the default export of boilerlift.config.ts when the folder has one', async () => {
    const cwd = await tempFolder();
    const config = { targets: { dev: { url: 'https://n8n.example.com', apiKeyEnv: 'N8N_API_KEY', workflows: './workflows' } } };
    await write(cwd, 'boilerlift.config.ts', `const config: object = ${JSON.stringify(config)};\nexport default config;\n`);

    const file = await nodeContext(cwd).loadProjectConfig();

    expect(file).toEqual({ kind: 'loaded', content: config });
  });

  test('Should return missing when the folder has no boilerlift.config.ts', async () => {
    const cwd = await tempFolder();

    const file = await nodeContext(cwd).loadProjectConfig();

    expect(file).toEqual({ kind: 'missing' });
  });

  test('Should return the reason when boilerlift.config.ts throws on import', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'boilerlift.config.ts', "throw new Error('bad config');\n");

    const file = await nodeContext(cwd).loadProjectConfig();

    expect(file).toEqual({ kind: 'unreadable', reason: 'bad config' });
  });

  test.each([
    ['an existing folder', 'workflows/a.json', true],
    ['a file', 'workflows', false],
    ['a missing path', 'other/a.json', false],
  ])('Should tell whether the path is a folder when it is %s', async (_condition, written, expected) => {
    const cwd = await tempFolder();
    await write(cwd, written, '{}');

    const isDirectory = await nodeContext(cwd).isDirectory('workflows');

    expect(isDirectory).toBe(expected);
  });
});
