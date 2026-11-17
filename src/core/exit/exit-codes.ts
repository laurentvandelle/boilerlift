// The process exit codes of every command, one name per code. Scripts read them, so a code means the same thing
// in every command. 0 is success. The usage text of each command lists the codes it can return.

/** Usage error, missing configuration or invalid workflow files: the user fixes the command or its input. */
export const EXIT_USAGE = 1;

/** Node.js is older than n8nlift requires. */
export const EXIT_NODE_TOO_OLD = 2;

/** The n8n instance or its public API cannot be reached. */
export const EXIT_UNREACHABLE = 3;

/** The instance rejects the API key. */
export const EXIT_API_KEY_REJECTED = 4;

/** At least one workflow failed; deploy still delivered the others. */
export const EXIT_PARTIAL_FAILURE = 5;

/** The instance cannot save drafts (older than MIN_N8N_VERSION in core/n8n/n8n-api.ts): nothing was written. */
export const EXIT_DRAFTS_UNSUPPORTED = 6;
