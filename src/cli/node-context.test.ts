import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { nodeContext } from '#src/cli/node-context';

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
  test('Should take the version from the package.json of boilerlift when it builds the context', async () => {
    const cwd = await tempFolder();

    const ctx = nodeContext(cwd);

    expect(ctx.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('Should resolve the paths of the file adapters from cwd when it builds the context', async () => {
    const cwd = await tempFolder();
    await write(cwd, 'boilerlift.lock.json', '{}\n');
    await write(cwd, 'workflows/a.json', '{}');
    const ctx = nodeContext(cwd);

    const read = [await ctx.readLockFile('boilerlift.lock.json'), await ctx.isDirectory('workflows'), await ctx.readPath('workflows')];

    expect(read).toEqual(['{}\n', true, { kind: 'folder', entries: ['a.json'] }]);
  });
});

/** Makes stdout and stderr terminals, or not, for one test, and sets the colour variables (`undefined` unsets one). */
function output(terminals: boolean, env: { NO_COLOR?: string; FORCE_COLOR?: string }): void {
  const before = { stdout: process.stdout.isTTY, stderr: process.stderr.isTTY };
  process.stdout.isTTY = terminals;
  process.stderr.isTTY = terminals;
  vi.stubEnv('NO_COLOR', env.NO_COLOR);
  vi.stubEnv('FORCE_COLOR', env.FORCE_COLOR);
  onTestFinished(() => {
    process.stdout.isTTY = before.stdout;
    process.stderr.isTTY = before.stderr;
    vi.unstubAllEnvs();
  });
}

describe('nodeContext color', () => {
  test('Should turn colour on when stdout and stderr are terminals', async () => {
    const cwd = await tempFolder();
    output(true, {});

    const ctx = nodeContext(cwd);

    expect(ctx.color).toBe(true);
  });

  test('Should turn colour off when the output is not a terminal', async () => {
    const cwd = await tempFolder();
    output(false, {});

    const ctx = nodeContext(cwd);

    expect(ctx.color).toBe(false);
  });

  test('Should turn colour off when NO_COLOR is set, even on a terminal', async () => {
    const cwd = await tempFolder();
    output(true, { NO_COLOR: '1' });

    const ctx = nodeContext(cwd);

    expect(ctx.color).toBe(false);
  });

  test('Should turn colour on when FORCE_COLOR is set, even without a terminal', async () => {
    const cwd = await tempFolder();
    output(false, { FORCE_COLOR: '1' });

    const ctx = nodeContext(cwd);

    expect(ctx.color).toBe(true);
  });

  test('Should turn colour off when FORCE_COLOR is 0, even on a terminal', async () => {
    const cwd = await tempFolder();
    output(true, { FORCE_COLOR: '0' });

    const ctx = nodeContext(cwd);

    expect(ctx.color).toBe(false);
  });
});
