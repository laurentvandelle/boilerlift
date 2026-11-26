import {
  BoilerliftConfig,
  CommandContext,
  CredentialsFile,
  FileCreation,
  PathContents,
  ProjectConfigFile,
  TemplateFetchError,
  TemplateFile,
} from '#src/cli/cli.model';
import { Result, err, ok } from '#src/core/common/result';

/**
 * A `CommandContext` for tests: no config file, a recent Node, a `fetch` that fails if called, no
 * workflow files, no terminal. Every folder exists.
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
    ask: () => Promise.reject(new Error('ask was called, but this test does not expect a question')),
    isInteractive: false,
    color: false,
    loadCredentialsFiles: () => Promise.resolve([]),
    writeCredentialsFile: () =>
      Promise.reject(new Error('writeCredentialsFile was called, but this test does not expect a credentials file write')),
    readPath: () => Promise.resolve({ kind: 'missing' }),
    fetchProjectTemplate: () => Promise.reject(new Error('fetchProjectTemplate was called, but this test does not expect a template')),
    createFile: () => Promise.reject(new Error('createFile was called, but this test does not expect a file write')),
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

export interface FakeCredentialsFolderOptions {
  /** The files of `credentials/` before the command runs, by path: their default export, or an import error. */
  files?: CredentialsFile[];
  /** When set, every write fails with this reason and leaves the files as they were. */
  writeFailure?: string;
}

/** An in-memory `credentials/` folder for `fakeContext`: seed it, read back what the command wrote, or make its writes fail. */
export interface FakeCredentialsFolder {
  /** Its `loadCredentialsFiles` and `writeCredentialsFile`, to spread into `fakeContext`. */
  context: Pick<CommandContext, 'loadCredentialsFiles' | 'writeCredentialsFile'>;
  /** The text written at `path`, or `undefined` when the command wrote nothing there. */
  text(path: string): string | undefined;
  /** The paths of every write, in order. */
  writes: string[];
}

export function fakeCredentialsFolder({ files = [], writeFailure }: FakeCredentialsFolderOptions = {}): FakeCredentialsFolder {
  const texts = new Map<string, string>();
  const writes: string[] = [];
  return {
    context: {
      loadCredentialsFiles: () => Promise.resolve(structuredClone(files)),
      writeCredentialsFile: (path, text): Promise<Result<void, { reason: string }>> => {
        writes.push(path);
        if (writeFailure !== undefined) {
          return Promise.resolve(err({ reason: writeFailure }));
        }
        texts.set(path, text);
        return Promise.resolve(ok(undefined));
      },
    },
    text: (path) => texts.get(path),
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

/** A stdin for `fakeContext({ ask })`: each question gets `answer` (`undefined`: stdin is closed), and is recorded. */
export interface FakeAnswer {
  ask: (prompt: string) => Promise<string | undefined>;
  /** Every prompt written, in order. */
  prompts: string[];
}

export function fakeAnswer(answer: string | undefined): FakeAnswer {
  const prompts: string[] = [];
  return {
    ask: (prompt): Promise<string | undefined> => {
      prompts.push(prompt);
      return Promise.resolve(answer);
    },
    prompts,
  };
}

export interface FakeProjectFolderOptions {
  /** The files of the Project template `fetchProjectTemplate` returns. */
  template?: TemplateFile[];
  /** When set, `fetchProjectTemplate` fails with this error instead. */
  fetchError?: TemplateFetchError;
  /** What `readPath` finds at the folder given to init. Default: nothing. */
  contents?: PathContents;
  /** The paths, relative to the current folder, that already hold a file. */
  existing?: string[];
  /** The paths whose write fails, with this reason. */
  failures?: Record<string, string>;
}

/**
 * An in-memory project folder for `fakeContext`: what is at the folder, the Project template or the error of its fetch,
 * the files already there, and the writes that fail.
 */
export interface FakeProjectFolder {
  /** Its `readPath`, `fetchProjectTemplate` and `createFile`, to spread into `fakeContext`. */
  context: Pick<CommandContext, 'readPath' | 'fetchProjectTemplate' | 'createFile'>;
  /** The text written at `path`, or `undefined` when the command created nothing there. */
  text(path: string): string | undefined;
  /** The paths of every write, in order. */
  writes: string[];
  /** The versions of every template fetch, in order. */
  fetches: string[];
}

export function fakeProjectFolder({
  template = [],
  fetchError,
  contents = { kind: 'missing' },
  existing = [],
  failures = {},
}: FakeProjectFolderOptions = {}): FakeProjectFolder {
  const texts = new Map<string, string>();
  const writes: string[] = [];
  const fetches: string[] = [];
  return {
    context: {
      readPath: () => Promise.resolve(structuredClone(contents)),
      fetchProjectTemplate: (version): Promise<Result<TemplateFile[], TemplateFetchError>> => {
        fetches.push(version);
        return Promise.resolve(fetchError === undefined ? ok(structuredClone(template)) : err(fetchError));
      },
      createFile: (path, text): Promise<FileCreation> => {
        writes.push(path);
        const reason = failures[path];
        if (reason !== undefined) {
          return Promise.resolve({ status: 'failed', reason });
        }
        if (existing.includes(path) || texts.has(path)) {
          return Promise.resolve({ status: 'exists' });
        }
        texts.set(path, text);
        return Promise.resolve({ status: 'created' });
      },
    },
    text: (path) => texts.get(path),
    writes,
    fetches,
  };
}
