import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { isRecord } from '#src/core/common/is-record';
import { Result, err, ok } from '#src/core/common/result';
import { TemplateFetchError, TemplateFile } from '#src/core/config/config.model';

/** The repository of the Project template. Each Boilerlift version `X.Y.Z` has its template there, tagged `vX.Y.Z`. */
export const PROJECT_TEMPLATE_URL = 'https://github.com/laurentvandelle/boilerlift-template.git';

/** What one git call did: it ran to the end, git could not be started (not installed), or it failed with its stderr. */
export type GitRun = { kind: 'done' } | { kind: 'not-found' } | { kind: 'failed'; stderr: string };

/** Runs `git` with `args`. */
export type GitRunner = (args: readonly string[]) => Promise<GitRun>;

export interface ProjectTemplateOptions {
  /** The folder the clone goes into, in a new folder of its own: the OS temp folder for the real process. */
  tempDir: string;
  git: GitRunner;
}

/** The environment variables `gitRunner` passes to git: `process.env` for the real process. */
export type GitEnvironment = Record<string, string | undefined>;

/**
 * `CommandContext.fetchProjectTemplate`: clones the tag `v<version>` of the template repository, with its last commit
 * only, into a new folder under `tempDir`, reads every file but those of `.git/`, then removes the folder, whether the
 * clone worked or not.
 */
export async function fetchProjectTemplate(version: string, { tempDir, git }: ProjectTemplateOptions): Promise<Result<TemplateFile[], TemplateFetchError>> {
  const tag = `v${version}`;
  const folder = await mkdtemp(join(tempDir, 'boilerlift-template-'));
  try {
    const run = await git(['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', tag, PROJECT_TEMPLATE_URL, folder]);
    switch (run.kind) {
    case 'not-found':
      return err({ kind: 'git-not-found', url: PROJECT_TEMPLATE_URL });
    case 'failed':
      return err(cloneError(tag, run.stderr));
    case 'done':
      return ok(await readTemplate(folder));
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * The `GitRunner` of the real process: `git` from the PATH of `env`, never asking for a password (a private or missing
 * repository fails instead of waiting for an answer), with its messages in English, so `cloneError` can read them.
 */
export function gitRunner(env: GitEnvironment): GitRunner {
  return (args) =>
    new Promise((resolveRun) => {
      execFile('git', args, { env: { ...env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (error, _stdout, stderr) => {
        if (error === null) {
          resolveRun({ kind: 'done' });
        } else if (isRecord(error) && error.code === 'ENOENT') {
          resolveRun({ kind: 'not-found' });
        } else {
          resolveRun({ kind: 'failed', stderr: stderr.trim() === '' ? error.message : stderr });
        }
      });
    });
}

/** A failed clone: the missing tag when git names it, else git's own `fatal:` message. */
function cloneError(tag: string, stderr: string): TemplateFetchError {
  if (/Remote branch \S+ not found/.test(stderr)) {
    return { kind: 'tag-not-found', url: PROJECT_TEMPLATE_URL, tag };
  }
  const lines = stderr.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const fatal = lines.filter((line) => line.startsWith('fatal:')).map((line) => line.slice('fatal:'.length).trim());
  return { kind: 'fetch-failed', url: PROJECT_TEMPLATE_URL, tag, reason: (fatal.length > 0 ? fatal : lines).join(' ') };
}

/** Every file under `root` but those of `.git/`, sorted by path, with `/` in the paths. */
async function readTemplate(root: string): Promise<TemplateFile[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((path) => path.split('/')[0] !== '.git')
    .sort();
  return Promise.all(paths.map(async (path) => ({ path, text: await readFile(join(root, path), 'utf8') })));
}
