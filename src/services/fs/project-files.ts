import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { CredentialsFile } from '#src/core/compile/credential.model';
import { isWorkflowFilePath } from '#src/core/compile/load-workflows';
import { WorkflowFile } from '#src/core/compile/workflow.model';
import { isRecord } from '#src/core/common/is-record';
import { Result, err, ok } from '#src/core/common/result';
import { FileCreation, PathContents, ProjectConfigFile } from '#src/core/config/config.model';

/** The environment variables `loadProjectConfig` fills from `.env`: `process.env` for the real process. */
export type Environment = Record<string, string | undefined>;

/** The streams `ask` talks through: stdin and stderr for the real process. */
export interface PromptStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/**
 * Imports the config file at `path`, once the variables of the `.env` file at `dotEnvPath` are in `env` so the file can
 * read them. A variable already set, and not blank, keeps its value. Node 22.18 and later strip TypeScript types
 * natively, so the file imports as is.
 */
export async function loadProjectConfig(path: string, dotEnvPath: string, env: Environment): Promise<ProjectConfigFile> {
  if (!(await isFile(path))) {
    return { kind: 'missing' };
  }
  const dotEnv = readDotEnv(dotEnvPath);
  if (dotEnv !== undefined) {
    for (const [key, value] of Object.entries(parseEnv(dotEnv))) {
      if (value !== undefined && (env[key] ?? '').trim() === '') {
        env[key] = value;
      }
    }
  }
  try {
    const module: unknown = await import(pathToFileURL(path).href);
    return { kind: 'loaded', content: isRecord(module) ? module.default : undefined };
  } catch (error) {
    return { kind: 'unreadable', reason: error instanceof Error ? error.message : String(error) };
  }
}

function readDotEnv(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

/** True when `path` is an existing file (not a folder). */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissingFile(error) || (isRecord(error) && error.code === 'ENOTDIR')) {
      return false;
    }
    throw error;
  }
}

/** True when `path` is an existing folder. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissingFile(error) || (isRecord(error) && error.code === 'ENOTDIR')) {
      return false;
    }
    throw error;
  }
}

/** `CommandContext.readPath`: nothing at `path`, a file, or a folder with the names of its entries, sorted. */
export async function readPath(path: string): Promise<PathContents> {
  try {
    if (!(await stat(path)).isDirectory()) {
      return { kind: 'file' };
    }
  } catch (error) {
    if (isMissingFile(error) || (isRecord(error) && error.code === 'ENOTDIR')) {
      return { kind: 'missing' };
    }
    throw error;
  }
  return { kind: 'folder', entries: (await readdir(path)).sort() };
}

/** Creates the file with the `wx` flag, so anything already at `path` is never overwritten. */
export async function createFile(path: string, text: string): Promise<FileCreation> {
  try {
    // A file in the way of the folder fails with EEXIST too: that is a failure, not a file already there.
    await mkdir(dirname(path), { recursive: true });
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  try {
    await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
    return { status: 'created' };
  } catch (error) {
    if (isRecord(error) && error.code === 'EEXIST') {
      return { status: 'exists' };
    }
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Raw text of the lock file at `path`, or `undefined` when there is no file. */
export async function readLockFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Writes the whole file. A disk error (permissions, full disk, a folder in the way) is returned, not thrown. */
export async function writeTextFile(path: string, text: string): Promise<Result<void, { reason: string }>> {
  try {
    await writeFile(path, text, 'utf8');
    return ok(undefined);
  } catch (error) {
    return err({ reason: error instanceof Error ? error.message : String(error) });
  }
}

/** Writes the whole file, creating its folder first. A disk error is returned, not thrown. */
export async function writeTextFileInFolder(path: string, text: string): Promise<Result<void, { reason: string }>> {
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (error) {
    return err({ reason: error instanceof Error ? error.message : String(error) });
  }
  return writeTextFile(path, text);
}

/** `CommandContext.loadWorkflowFiles`, with `dir` resolved from `cwd` and the paths relative to `cwd`. */
export async function loadWorkflowFiles(cwd: string, dir: string): Promise<WorkflowFile[]> {
  const root = resolve(cwd, dir);
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
  const files = entries
    .filter(isWorkflowFilePath)
    .filter((entry) => !entry.split(sep).includes('node_modules'))
    .map((entry) => resolve(root, entry))
    .sort();
  return Promise.all(files.map((absolute) => readWorkflowFile(cwd, absolute)));
}

async function readWorkflowFile(cwd: string, absolute: string): Promise<WorkflowFile> {
  const path = relative(cwd, absolute).split(sep).join('/');
  try {
    if (absolute.endsWith('.json')) {
      const content: unknown = JSON.parse(await readFile(absolute, 'utf8'));
      return { path, content };
    }
    // Node 22.18 and later strip TypeScript types natively, so a .workflow.ts file imports as is.
    const module: unknown = await import(pathToFileURL(absolute).href);
    return { path, content: isRecord(module) ? module.default : undefined };
  } catch (error) {
    return { path, error: error instanceof Error ? error.message : String(error) };
  }
}

/** `CommandContext.loadCredentialsFiles`, with `dir` resolved from `cwd` and the paths relative to `cwd`. */
export async function loadCredentialsFiles(cwd: string, dir: string): Promise<CredentialsFile[]> {
  const root = resolve(cwd, dir);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (isMissingFile(error) || (isRecord(error) && error.code === 'ENOTDIR')) {
      return [];
    }
    throw error;
  }
  const files = entries.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts')).map((entry) => resolve(root, entry)).sort();
  const loaded: CredentialsFile[] = [];
  for (const absolute of files) {
    const path = relative(cwd, absolute).split(sep).join('/');
    try {
      const module: unknown = await import(pathToFileURL(absolute).href);
      loaded.push({ path, content: isRecord(module) ? module.default : undefined });
    } catch (error) {
      loaded.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return loaded;
}

/** `CommandContext.ask`: the prompt on `output`, then the first line of `input`, or `undefined` when it closes first. */
export function ask(prompt: string, streams: PromptStreams): Promise<string | undefined> {
  streams.output.write(prompt);
  return new Promise((resolveAnswer) => {
    const lines = createInterface({ input: streams.input, terminal: false });
    let answer: string | undefined;
    lines.once('line', (line) => {
      answer = line;
      lines.close();
    });
    lines.once('close', () => {
      if (answer === undefined) {
        // EOF: end the prompt line, so what follows starts on its own line.
        streams.output.write('\n');
      }
      resolveAnswer(answer);
    });
  });
}

/** True when a file system call failed because the path does not exist (`ENOENT`). */
function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
