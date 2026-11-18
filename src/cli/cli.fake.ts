import { BoilerliftConfig, CommandContext, ProjectConfigFile } from '#src/cli/cli.model';
import { Result, err, ok } from '#src/core/common/result';

/**
 * A `CommandContext` for tests: no config file, a recent Node, a `fetch` that fails if called, no
 * workflow files. Every folder exists.
 */
export function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    version: '0.0.0',
    registry: [],
    loadProjectConfig: () => Promise.resolve({ kind: 'missing' }),
    isDirectory: () => Promise.resolve(true),
    nodeVersion: '24.0.0',
    fetch: () => Promise.reject(new Error('fetch was called, but this test does not expect network calls')),
    loadWorkflowFiles: () => Promise.resolve([]),
    readLockFile: () => Promise.resolve(undefined),
    writeLockFile: () => Promise.reject(new Error('writeLockFile was called, but this test does not expect a lock file write')),
    ...overrides,
  };
}

export interface FakeLockFileOptions {
  /** The text of the lock file before the command runs. `undefined`: there is no file. */
  text?: string;
  /** When set, every write fails with this reason and leaves the text as it was. */
  writeFailure?: string;
}

/** An in-memory lock file for `fakeContext`: seed it, read back what the command wrote, or make its writes fail. */
export interface FakeLockFile {
  /** Its `readLockFile` and `writeLockFile`, to spread into `fakeContext`. */
  context: Pick<CommandContext, 'readLockFile' | 'writeLockFile'>;
  /** The text the file holds now, or `undefined` when there is none. */
  text(): string | undefined;
  /** The paths of every write, in order. */
  writes: string[];
}

export function fakeLockFile({ text: seed, writeFailure }: FakeLockFileOptions = {}): FakeLockFile {
  let text = seed;
  const writes: string[] = [];
  return {
    context: {
      readLockFile: () => Promise.resolve(text),
      writeLockFile: (path, next): Promise<Result<void, { reason: string }>> => {
        writes.push(path);
        if (writeFailure !== undefined) {
          return Promise.resolve(err({ reason: writeFailure }));
        }
        text = next;
        return Promise.resolve(ok(undefined));
      },
    },
    text: () => text,
    writes,
  };
}

/** A config file whose default export is `config`, for `fakeContext({ loadProjectConfig: fakeProjectConfig(…) })`. */
export function fakeProjectConfig(config: BoilerliftConfig | Record<string, unknown>): () => Promise<ProjectConfigFile> {
  return () => Promise.resolve({ kind: 'loaded', content: config });
}

/** The origins of the two targets of `fakeTwoTargets`. */
export const FAKE_DEV_URL = 'https://dev.example.com';
export const FAKE_PROD_URL = 'https://prod.example.com';

/** A config with two targets, in this order: `dev` (key dev-secret, files ./dev) and `prod` (key prod-secret, files ./prod). */
export function fakeTwoTargets(): () => Promise<ProjectConfigFile> {
  return fakeProjectConfig({
    targets: {
      dev: { url: FAKE_DEV_URL, apiKey: 'dev-secret', workflows: './dev' },
      prod: { url: FAKE_PROD_URL, apiKey: 'prod-secret', workflows: './prod' },
    },
  });
}

/** A config with the single target `dev` at `url`, with `apiKey` and its files in ./workflows. */
export function fakeSingleTarget(url = 'https://n8n.example.com', apiKey = 'secret'): () => Promise<ProjectConfigFile> {
  return fakeProjectConfig({ targets: { dev: { url, apiKey, workflows: './workflows' } } });
}
