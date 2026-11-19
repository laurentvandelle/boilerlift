import { readFileSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { CommandContext, ProjectConfigFile, WorkflowFile } from '#src/cli/cli.model';
import { COMMANDS } from '#src/cli/registry';
import { isWorkflowFilePath } from '#src/core/compile/load-workflows';
import { isRecord } from '#src/core/common/is-record';
import { CONFIG_FILE } from '#src/core/config/project-config';
import { Result, err, ok } from '#src/core/common/result';

/**
 * The CommandContext of this Node process, which bin.ts hands to runCli: its environment, Node version and
 * `fetch`, the Boilerlift version, and the project config (with its `.env`), workflow files and lock file of `cwd`.
 */
export function nodeContext(cwd: string): CommandContext {
  return {
    version: packageVersion(),
    registry: COMMANDS,
    loadProjectConfig: () => loadProjectConfig(join(cwd, CONFIG_FILE), join(cwd, '.env')),
    isDirectory: (path) => isDirectory(resolve(cwd, path)),
    nodeVersion: process.versions.node,
    fetch: globalThis.fetch,
    loadWorkflowFiles: (dir) => loadWorkflowFiles(cwd, dir),
    readLockFile: (path) => readLockFile(resolve(cwd, path)),
    writeLockFile: (path, text) => writeLockFile(resolve(cwd, path), text),
    ask,
  };
}

/** `CommandContext.ask`: the prompt on stderr, then the first line of stdin, or `undefined` when stdin closes first. */
function ask(prompt: string): Promise<string | undefined> {
  process.stderr.write(prompt);
  return new Promise((resolveAnswer) => {
    const lines = createInterface({ input: process.stdin, terminal: false });
    let answer: string | undefined;
    lines.once('line', (line) => {
      answer = line;
      lines.close();
    });
    lines.once('close', () => {
      if (answer === undefined) {
        // EOF: end the prompt line, so what follows starts on its own line.
        process.stderr.write('\n');
      }
      resolveAnswer(answer);
    });
  });
}

/** The version in the boilerlift package.json, two folders above this file (`src/cli/` or `dist/cli/`). */
function packageVersion(): string {
  const path = join(__dirname, '..', '..', 'package.json');
  const packageJson: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(packageJson) || typeof packageJson.version !== 'string') {
    throw new Error(`${path} has no version`);
  }
  return packageJson.version;
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

/**
 * Imports the config file, once the variables of `.env` are in `process.env` so the file can read them. A variable
 * already set, and not blank, keeps its value. Node 22.18 and later strip TypeScript types natively, so the file
 * imports as is.
 */
async function loadProjectConfig(path: string, dotEnvPath: string): Promise<ProjectConfigFile> {
  if (!(await isFile(path))) {
    return { kind: 'missing' };
  }
  const dotEnv = readDotEnv(dotEnvPath);
  if (dotEnv !== undefined) {
    for (const [key, value] of Object.entries(parseEnv(dotEnv))) {
      if (value !== undefined && (process.env[key] ?? '').trim() === '') {
        process.env[key] = value;
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

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissingFile(error) || (isRecord(error) && error.code === 'ENOTDIR')) {
      return false;
    }
    throw error;
  }
}

async function readLockFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Writes the whole lock file. A disk error (permissions, full disk, a folder in the way) is returned, not thrown. */
async function writeLockFile(path: string, text: string): Promise<Result<void, { reason: string }>> {
  try {
    await writeFile(path, text, 'utf8');
    return ok(undefined);
  } catch (error) {
    return err({ reason: error instanceof Error ? error.message : String(error) });
  }
}

/** `CommandContext.loadWorkflowFiles`, with `dir` resolved from `cwd`. */
async function loadWorkflowFiles(cwd: string, dir: string): Promise<WorkflowFile[]> {
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

/** True when a file system call failed because the path does not exist (`ENOENT`). */
function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
