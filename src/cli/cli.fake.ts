import { CommandContext } from '#src/cli/cli.model';
import { Result, err, ok } from '#src/core/common/result';

/** A `CommandContext` for tests: no env, no `.env`, a recent Node, a `fetch` that fails if called, no workflow files. */
export function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    version: '0.0.0',
    registry: [],
    env: {},
    dotEnv: undefined,
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
