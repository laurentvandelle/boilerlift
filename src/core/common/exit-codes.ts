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
  | typeof EXIT_CREDENTIALS_WRITE_FAILED;

/** The exit code of a failure: any code but EXIT_OK. */
export type FailureExitCode = Exclude<ExitCode, typeof EXIT_OK>;
