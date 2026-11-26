import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, onTestFinished, test } from 'vitest';
import { GitRun, GitRunner, PROJECT_TEMPLATE_URL, fetchProjectTemplate, gitRunner } from '#src/services/git/project-template';

/** A new empty folder in the system temp folder, deleted when the test ends. */
async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'boilerlift-project-template-'));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

/** A git that records its calls and, for a clone, writes `files` into the folder it clones into (its last argument). */
function fakeGit(files: Record<string, string>, run: GitRun = { kind: 'done' }): { git: GitRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    const folder = args.at(-1) ?? '';
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), text);
    }
    return run;
  };
  return { git, calls };
}

describe('fetchProjectTemplate', () => {
  test('Should clone the tag of the version, with its last commit only, from the template repository when it fetches the template', async () => {
    const tempDir = await tempFolder();
    const { git, calls } = fakeGit({ 'README.md': '# Project\n' });

    await fetchProjectTemplate('1.4.2', { tempDir, git });

    expect(calls.map((args) => args.slice(0, -1))).toEqual([
      ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', 'v1.4.2', PROJECT_TEMPLATE_URL],
    ]);
  });

  test('Should return every file but those of .git, sorted by path, when the clone works', async () => {
    const tempDir = await tempFolder();
    const { git } = fakeGit({ 'workflows/hello.workflow.ts': 'hello\n', '.git/HEAD': 'ref\n', '.gitignore': '.env\n', 'README.md': '# Project\n' });

    const template = await fetchProjectTemplate('1.4.2', { tempDir, git });

    expect(template).toEqual({
      ok: true,
      value: [
        { path: '.gitignore', text: '.env\n' },
        { path: 'README.md', text: '# Project\n' },
        { path: 'workflows/hello.workflow.ts', text: 'hello\n' },
      ],
    });
  });

  test('Should remove the clone folder when the clone works', async () => {
    const tempDir = await tempFolder();
    const { git } = fakeGit({ 'README.md': '# Project\n' });

    await fetchProjectTemplate('1.4.2', { tempDir, git });

    expect(await readdir(tempDir)).toEqual([]);
  });

  test('Should remove the clone folder when the clone fails', async () => {
    const tempDir = await tempFolder();
    const { git } = fakeGit({ 'README.md': '# Project\n' }, { kind: 'failed', stderr: 'fatal: early EOF\n' });

    await fetchProjectTemplate('1.4.2', { tempDir, git });

    expect(await readdir(tempDir)).toEqual([]);
  });

  test('Should return git-not-found with the template URL when git cannot be started', async () => {
    const tempDir = await tempFolder();
    const { git } = fakeGit({}, { kind: 'not-found' });

    const template = await fetchProjectTemplate('1.4.2', { tempDir, git });

    expect(template).toEqual({ ok: false, error: { kind: 'git-not-found', url: PROJECT_TEMPLATE_URL } });
  });

  test('Should return tag-not-found with the tag when the repository has no tag for the version', async () => {
    const tempDir = await tempFolder();
    const stderr = 'warning: Could not find remote branch v1.4.2 to clone.\nfatal: Remote branch v1.4.2 not found in upstream origin\n';
    const { git } = fakeGit({}, { kind: 'failed', stderr });

    const template = await fetchProjectTemplate('1.4.2', { tempDir, git });

    expect(template).toEqual({ ok: false, error: { kind: 'tag-not-found', url: PROJECT_TEMPLATE_URL, tag: 'v1.4.2' } });
  });

  test('Should return fetch-failed with the fatal message of git when the repository cannot be reached', async () => {
    const tempDir = await tempFolder();
    const stderr = "fatal: unable to access 'https://github.com/laurentvandelle/boilerlift-template.git/': Could not resolve host: github.com\n";
    const { git } = fakeGit({}, { kind: 'failed', stderr });

    const template = await fetchProjectTemplate('1.4.2', { tempDir, git });

    expect(template).toEqual({
      ok: false,
      error: {
        kind: 'fetch-failed',
        url: PROJECT_TEMPLATE_URL,
        tag: 'v1.4.2',
        reason: "unable to access 'https://github.com/laurentvandelle/boilerlift-template.git/': Could not resolve host: github.com",
      },
    });
  });
});

describe('gitRunner', () => {
  test('Should return done when git runs to the end', async () => {
    const run = await gitRunner(process.env)(['--version']);

    expect(run).toEqual({ kind: 'done' });
  });

  test('Should return not-found when git is not on the PATH', async () => {
    const run = await gitRunner({ ...process.env, PATH: '' })(['--version']);

    expect(run).toEqual({ kind: 'not-found' });
  });

  test('Should return the English stderr of git when the call fails, whatever the locale', async () => {
    const folder = await tempFolder();

    const run = await gitRunner({ ...process.env, LANG: 'fr_FR.UTF-8', LC_ALL: 'fr_FR.UTF-8' })(['clone', join(folder, 'missing'), join(folder, 'clone')]);

    expect(run.kind === 'failed' && run.stderr.includes('does not exist')).toBe(true);
  });
});
