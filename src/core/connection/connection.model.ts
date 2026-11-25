import { ConnectionConfig } from '#src/core/config/config.model';
import { N8nClient } from '#src/core/n8n/n8n.model';

export type CheckName = 'node' | 'url' | 'apiKey';

/**
 * Why a check failed: Node.js is older than MIN_NODE_VERSION (`node-too-old`), the instance or its public API cannot be
 * reached (`unreachable`), or the instance rejects the API key (`key-rejected`).
 */
export type CheckFailure = 'node-too-old' | 'unreachable' | 'key-rejected';

/** A check that failed: why, and the next step for the user. */
export interface FailedCheck {
  name: CheckName;
  status: 'failed';
  detail: string;
  hint: string;
  failure: CheckFailure;
}

/** One check, keyed by status: only a failed check carries a hint and its failure. */
export type Check = { name: CheckName; status: 'ok' | 'skipped'; detail: string } | FailedCheck;

export type CheckStatus = Check['status'];

export interface ConnectionReport {
  checks: Check[];
  warnings: string[];
}

export interface CheckConnectionInput {
  nodeVersion: string;
  config: ConnectionConfig;
  /** Only the two read-only probes: `ping` never writes. */
  client: Pick<N8nClient, 'checkHealth' | 'checkApiKey'>;
}
