import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CommandContext } from '#src/cli/cli.model';
import { COMMANDS } from '#src/cli/registry';
import { isRecord } from '#src/core/common/is-record';
import { CONFIG_FILE } from '#src/core/config/project-config';
import {
  ask,
  createFile,
  isDirectory,
  loadCredentialsFiles,
  loadProjectConfig,
  loadWorkflowFiles,
  readLockFile,
  readPath,
  writeTextFile,
  writeTextFileInFolder,
} from '#src/services/fs/project-files';
import { fetchProjectTemplate, gitRunner } from '#src/services/git/project-template';

/**
 * The CommandContext of this Node process, which bin.ts hands to runCli: its environment, Node version, terminals and
 * `fetch`, the Boilerlift version, the file adapters of services/fs/ with every path resolved from `cwd`, and the
 * Project template fetch of services/git/.
 */
export function nodeContext(cwd: string): CommandContext {
  return {
    version: packageVersion(),
    registry: COMMANDS,
    loadProjectConfig: () => loadProjectConfig(join(cwd, CONFIG_FILE), join(cwd, '.env'), process.env),
    isDirectory: (path) => isDirectory(resolve(cwd, path)),
    nodeVersion: process.versions.node,
    fetch: globalThis.fetch,
    loadWorkflowFiles: (dir) => loadWorkflowFiles(cwd, dir),
    readLockFile: (path) => readLockFile(resolve(cwd, path)),
    writeLockFile: (path, text) => writeTextFile(resolve(cwd, path), text),
    loadCredentialsFiles: (dir) => loadCredentialsFiles(cwd, dir),
    writeCredentialsFile: (path, text) => writeTextFileInFolder(resolve(cwd, path), text),
    ask: (prompt) => ask(prompt, { input: process.stdin, output: process.stderr }),
    isInteractive: process.stdin.isTTY === true,
    color: outputColor(process.env, process.stdout.isTTY === true && process.stderr.isTTY === true),
    readPath: (path) => readPath(resolve(cwd, path)),
    fetchProjectTemplate: (version) => fetchProjectTemplate(version, { tempDir: tmpdir(), git: gitRunner(process.env) }),
    createFile: (path, text) => createFile(resolve(cwd, path), text),
  };
}

/** `CommandContext.color`: `FORCE_COLOR` first (`0` or `false` turn colour off), then `NO_COLOR`, then the terminals. */
function outputColor(env: NodeJS.ProcessEnv, terminals: boolean): boolean {
  const force = env['FORCE_COLOR'];
  if (force !== undefined) {
    return force !== '0' && force !== 'false';
  }
  if ((env['NO_COLOR'] ?? '') !== '') {
    return false;
  }
  return terminals;
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
