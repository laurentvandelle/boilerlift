import { CheckFailure, ConnectionReport } from '#src/core/connection/connection.model';
import { SyncError, SyncReport } from '#src/core/credentials/credentials.model';
import { DeployErrorKind, RunEnd } from '#src/core/deliver/deploy.model';
import { StatusReport } from '#src/core/status/status.model';

// The process exit codes of every command, one name per code. Scripts read them, so a code means the same thing
// in every command. The usage text of each command lists the codes it can return.

/** Success: every check passed, or every workflow was delivered. */
export const EXIT_OK = 0;

/** Usage error, missing configuration or invalid workflow files: the user fixes the command or its input. */
export const EXIT_USAGE = 1;

/**
 * An unexpected error (a bug or a broken environment) that reached bin.ts. It shares code 1 with EXIT_USAGE, as Node
 * does for an uncaught error; the stack on stderr, without the help, tells the two apart.
 */
export const EXIT_UNEXPECTED = 1;

/** Node.js is older than Boilerlift requires. */
export const EXIT_NODE_TOO_OLD = 2;

/** The n8n instance or its public API cannot be reached. */
export const EXIT_UNREACHABLE = 3;

/** The instance rejects the API key. */
export const EXIT_API_KEY_REJECTED = 4;

/** At least one workflow failed; deploy still delivered the others. */
export const EXIT_PARTIAL_FAILURE = 5;

/** The instance cannot save drafts (older than MIN_N8N_VERSION in core/n8n/n8n-api.ts): nothing was written. */
export const EXIT_DRAFTS_UNSUPPORTED = 6;

/** Deploy created a workflow but could not record its id in boilerlift.lock.json: the run stopped there. */
export const EXIT_LOCK_WRITE_FAILED = 7;

/** creds sync wrote the list of a target, but workflows of that target use credentials the list does not have. */
export const EXIT_CREDENTIALS_MISSING = 8;

/** The API key cannot list the credentials: it lacks the `credential:list` scope. The list was left as it was. */
export const EXIT_CREDENTIAL_SCOPE_MISSING = 9;

/** creds sync could not write the credentials file of a target. */
export const EXIT_CREDENTIALS_WRITE_FAILED = 10;

/**
 * clean found workflows to archive, but could not ask: no terminal, or --json, and neither --yes nor --force. Nothing
 * was archived; run it again with --yes.
 */
export const EXIT_CONFIRMATION_NEEDED = 11;

/** init could not write at least one file of the project; it still wrote the others. A rerun fills the gaps. */
export const EXIT_INIT_WRITE_FAILED = 12;

/** Every exit code a command can return. EXIT_UNEXPECTED is EXIT_USAGE's code, so the union lists it once. */
export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_USAGE
  | typeof EXIT_NODE_TOO_OLD
  | typeof EXIT_UNREACHABLE
  | typeof EXIT_API_KEY_REJECTED
  | typeof EXIT_PARTIAL_FAILURE
  | typeof EXIT_DRAFTS_UNSUPPORTED
  | typeof EXIT_LOCK_WRITE_FAILED
  | typeof EXIT_CREDENTIALS_MISSING
  | typeof EXIT_CREDENTIAL_SCOPE_MISSING
  | typeof EXIT_CREDENTIALS_WRITE_FAILED
  | typeof EXIT_CONFIRMATION_NEEDED
  | typeof EXIT_INIT_WRITE_FAILED;

/** The exit code of a failure: any code but EXIT_OK. */
export type FailureExitCode = Exclude<ExitCode, typeof EXIT_OK>;

// What core returns, mapped to the exit code of the process. Core tags its outcomes and errors; only this file says
// which code each one exits with, so a new kind fails the type check here.

/** The exit code of a deploy error that stops the run. */
export function deployErrorExitCode(kind: DeployErrorKind): FailureExitCode {
  switch (kind) {
  case 'unreachable':
    return EXIT_UNREACHABLE;
  case 'key-rejected':
    return EXIT_API_KEY_REJECTED;
  case 'drafts-unsupported':
    return EXIT_DRAFTS_UNSUPPORTED;
  case 'credential-scope-missing':
    return EXIT_CREDENTIAL_SCOPE_MISSING;
  case 'credentials-missing':
    return EXIT_CREDENTIALS_MISSING;
  case 'workflow-failed':
    return EXIT_PARTIAL_FAILURE;
  case 'lock-write-failed':
    return EXIT_LOCK_WRITE_FAILED;
  }
}

/** The exit code of a deploy or a dry run on one target: 0, 5 when a workflow failed, or the code of the stop. */
export function runEndExitCode(end: RunEnd): ExitCode {
  switch (end.outcome) {
  case 'completed':
    return EXIT_OK;
  case 'partial':
    return EXIT_PARTIAL_FAILURE;
  case 'stopped':
    return deployErrorExitCode(end.error.kind);
  }
}

/** The exit code of a failed ping check. */
export function checkFailureExitCode(failure: CheckFailure): FailureExitCode {
  switch (failure) {
  case 'node-too-old':
    return EXIT_NODE_TOO_OLD;
  case 'unreachable':
    return EXIT_UNREACHABLE;
  case 'key-rejected':
    return EXIT_API_KEY_REJECTED;
  }
}

/** The exit code of a ping on one target: the code of its failed check, or 0 when every check passed. */
export function connectionExitCode(report: ConnectionReport): ExitCode {
  const failed = report.checks.find((check) => check.status === 'failed');
  return failed?.status === 'failed' ? checkFailureExitCode(failed.failure) : EXIT_OK;
}

/** The exit code of a run of writes that went to the end: 0, or 5 when one of them failed (`partial`). */
export function outcomeExitCode(outcome: 'completed' | 'partial'): typeof EXIT_OK | typeof EXIT_PARTIAL_FAILURE {
  switch (outcome) {
  case 'completed':
    return EXIT_OK;
  case 'partial':
    return EXIT_PARTIAL_FAILURE;
  }
}

/** The exit code of a read that stopped a command before any write: 4 for a rejected API key, 3 otherwise. */
export function readErrorExitCode(kind: 'unreachable' | 'key-rejected' | 'read-failed'): typeof EXIT_UNREACHABLE | typeof EXIT_API_KEY_REJECTED {
  switch (kind) {
  case 'key-rejected':
    return EXIT_API_KEY_REJECTED;
  case 'unreachable':
  case 'read-failed':
    return EXIT_UNREACHABLE;
  }
}

/** The exit code of a status on one target: 0 whenever it could read everything, whatever the states. */
export function statusExitCode(report: StatusReport): ExitCode {
  return report.error === undefined ? EXIT_OK : readErrorExitCode(report.error.kind);
}

/** The exit code of a creds sync error: the list was left as it was. */
export function syncErrorExitCode(kind: SyncError['kind']): FailureExitCode {
  switch (kind) {
  case 'unreachable':
    return EXIT_UNREACHABLE;
  case 'key-rejected':
    return EXIT_API_KEY_REJECTED;
  case 'scope-missing':
    return EXIT_CREDENTIAL_SCOPE_MISSING;
  case 'write-failed':
    return EXIT_CREDENTIALS_WRITE_FAILED;
  }
}

/** The exit code of a creds sync on one target: 0, 8 when the list was written but workflows use missing keys, or the code of its error. */
export function syncExitCode(report: SyncReport): ExitCode {
  switch (report.status) {
  case 'synced':
    return report.missing.length === 0 ? EXIT_OK : EXIT_CREDENTIALS_MISSING;
  case 'failed':
    return syncErrorExitCode(report.error.kind);
  }
}
