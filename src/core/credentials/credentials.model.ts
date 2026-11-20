import { CredentialEntry } from '#src/core/compile/credential.model';
import { WorkflowFile } from '#src/core/compile/workflow.model';
import { EXIT_CREDENTIALS_MISSING, EXIT_OK, FailureExitCode } from '#src/core/common/exit-codes';
import { Result } from '#src/core/common/result';
import { N8nClient } from '#src/core/n8n/n8n.model';

/** One `credentials/<target>.ts` file found in the project: its default export, or why it could not be imported. */
export type CredentialsFile = { path: string; content: unknown } | { path: string; error: string };

/** Writes `text` as the whole file at `path`. A disk error comes back as a failure with its `reason`, never a throw. */
export type CredentialsWriter = (path: string, text: string) => Promise<Result<void, { reason: string }>>;

export interface SyncInput {
  /** The target name: it names the file, `credentials/<target>.ts`. */
  target: string;
  client: N8nClient;
  /** The workflow files of the folder of the target, scanned for `credential()` uses. */
  files: readonly WorkflowFile[];
  /** The type of each key of the lists the project held before the sync, so a key gone from the instance keeps its type. */
  knownTypes: ReadonlyMap<string, string>;
}

/** A key that workflows of the target use and that its list does not have. */
export interface MissingCredential {
  key: string;
  /** The type of the key, from a list of the project; `undefined` when no list ever held it. */
  type: string | undefined;
  /** The workflows that use it, by stable name, sorted. */
  workflows: string[];
}

/**
 * Why a sync stopped. Each one leaves the list as it was.
 * - `unreachable`: the instance gives no answer, an answer that is not the n8n public API, or an error status.
 * - `key-rejected`: the instance rejects the API key (401).
 * - `scope-missing`: the API key cannot list credentials (403): it lacks the `credential:list` scope.
 * - `write-failed`: the list could not be written to its file.
 */
export type SyncError =
  | { kind: 'unreachable' | 'key-rejected' | 'scope-missing'; call: string; detail: string; hint: string }
  | { kind: 'write-failed'; path: string; detail: string; hint: string };

export type SyncReport =
  | {
    status: 'synced';
    /** The file written: `credentials/<target>.ts`. */
    file: string;
    /** The list written, sorted by key. */
    credentials: CredentialEntry[];
    /** Sorted by key. */
    missing: MissingCredential[];
    exitCode: typeof EXIT_OK | typeof EXIT_CREDENTIALS_MISSING;
  }
  | { status: 'failed'; error: SyncError; exitCode: FailureExitCode };
