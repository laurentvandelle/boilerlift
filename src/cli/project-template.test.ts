import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, onTestFinished, test } from 'vitest';
import { initCommand } from '#src/cli/commands/init/init.command';
import { nodeContext } from '#src/cli/node-context';

const REPOSITORY = join(__dirname, '..', '..');

/** A new empty folder in the system temp folder, deleted when the test ends. */
async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'boilerlift-project-template-'));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

/**
 * Stands in for `npm install`, which needs the network: each package of the repository's node_modules is linked into
 * the project, and boilerlift itself is compiled from src/ into node_modules/boilerlift, as npm would unpack it.
 * The devDependencies of the template are devDependencies of the repository too, so they are all there.
 */
async function installFromRepository(project: string): Promise<void> {
  const modules = join(project, 'node_modules');
  await mkdir(join(modules, 'boilerlift'), { recursive: true });
  for (const entry of await readdir(join(REPOSITORY, 'node_modules'))) {
    await symlink(join(REPOSITORY, 'node_modules', entry), join(modules, entry));
  }
  const tsc = join(REPOSITORY, 'node_modules', 'typescript', 'bin', 'tsc');
  const build = ['-p', join(REPOSITORY, 'tsconfig.build.json'), '--outDir', join(modules, 'boilerlift', 'dist'), '--sourceMap', 'false'];
  const compiled = spawnSync(process.execPath, [tsc, ...build], { encoding: 'utf8' });
  if (compiled.status !== 0) {
    throw new Error(`boilerlift did not compile:\n${compiled.stdout}${compiled.stderr}`);
  }
  await copyFile(join(REPOSITORY, 'package.json'), join(modules, 'boilerlift', 'package.json'));
}

describe('lift init project', () => {
  test('Should pass its own npm run verify when init writes a fresh project', { timeout: 120_000 }, async () => {
    const project = await tempFolder();
    await initCommand.run({ positionals: [], values: {} }, nodeContext(project));
    await installFromRepository(project);

    const verify = spawnSync('npm', ['run', 'verify'], { cwd: project, encoding: 'utf8', env: { ...process.env, CI: 'true' } });

    expect(verify.status, `npm run verify failed in the new project:\n${verify.stdout}${verify.stderr}`).toBe(0);
  });
});
