import { ConnectionConfig } from '#src/core/config/config.model';

export interface N8nClientOptions {
  /** The url of the target, without trailing slash, and its API key, as resolveTargets returns them. */
  config: ConnectionConfig;
  fetch: typeof fetch;
  timeoutMs?: number;
}
