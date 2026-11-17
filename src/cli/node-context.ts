import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommandContext, WorkflowFile } from '#src/cli/cli.model';
import { COMMANDS } from '#src/cli/registry';
import { isWorkflowFilePath } from '#src/core/compile/load-workflows';
import { isRecord } from '#src/core/guard/is-record';

/**
 * The CommandContext of this Node process, which bin.ts hands to runCli: its environment, Node version and
 * `fetch`, the n8nlift version, and the `.env` file and workflow files of `cwd`.
 */
export function nodeContext(cwd: string): CommandContext {
  return {
    version: packageVersion(),
    registry: COMMANDS,
    env: process.env,
    dotEnv: readDotEnv(join(cwd, '.env')),
    nodeVersion: process.versions.node,
    fetch: globalThis.fetch,
    loadWorkflowFiles: (dir) => loadWorkflowFiles(cwd, dir),
  };
}

/** The version in the n8nlift package.json, two folders above this file (`src/cli/` or `dist/cli/`). */
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
