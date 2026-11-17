import { ConnectionConfig } from '#src/core/config/config.model';

export interface N8nClientOptions {
  /** N8N_URL, the instance root without trailing slash, and N8N_API_KEY, as resolveConnectionConfig returns them. */
  config: ConnectionConfig;
  fetch: typeof fetch;
  timeoutMs?: number;
}
