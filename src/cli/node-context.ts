import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CommandContext, WorkflowFile } from '#src/cli/cli.model';
import { COMMANDS } from '#src/cli/registry';

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
  const packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
  return packageJson.version;
}

function readDotEnv(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/** Reads every `*.workflow.ts` and `*.json` file under `dir` (resolved from `cwd`), recursively, sorted by path. */
async function loadWorkflowFiles(cwd: string, dir: string): Promise<WorkflowFile[]> {
  const root = resolve(cwd, dir);
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const files = entries
    .filter((entry) => entry.endsWith('.workflow.ts') || entry.endsWith('.json'))
    .filter((entry) => !entry.split(sep).includes('node_modules'))
    .map((entry) => resolve(root, entry))
    .sort();
  return Promise.all(files.map((absolute) => readWorkflowFile(cwd, absolute)));
}

async function readWorkflowFile(cwd: string, absolute: string): Promise<WorkflowFile> {
  const path = relative(cwd, absolute).split(sep).join('/');
  try {
    if (absolute.endsWith('.json')) {
      return { path, content: JSON.parse(await readFile(absolute, 'utf8')) as unknown };
    }
    // Node 22.18 and later strip TypeScript types natively, so a .workflow.ts file imports as is.
    const module = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
    return { path, content: module.default };
  } catch (error) {
    return { path, error: error instanceof Error ? error.message : String(error) };
  }
}
