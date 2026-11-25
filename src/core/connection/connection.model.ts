import { ConnectionConfig } from '#src/core/config/config.model';
import { ExitCode, FailureExitCode } from '#src/cli/exit-codes';
import { N8nClient } from '#src/core/n8n/n8n.model';

export type CheckName = 'node' | 'url' | 'apiKey';

/** A check that failed: the next step for the user, and the process exit code. */
export interface FailedCheck {
  name: CheckName;
  status: 'failed';
  detail: string;
  hint: string;
  exitCode: FailureExitCode;
}

/** One check, keyed by status: only a failed check carries a hint and an exit code. */
export type Check = { name: CheckName; status: 'ok' | 'skipped'; detail: string } | FailedCheck;

export type CheckStatus = Check['status'];

export interface ConnectionReport {
  checks: Check[];
  warnings: string[];
  /** The first failed check's exit code, or 0 when every check passed. */
  exitCode: ExitCode;
}

export interface CheckConnectionInput {
  nodeVersion: string;
  config: ConnectionConfig;
  /** Only the two read-only probes: `ping` never writes. */
  client: Pick<N8nClient, 'checkHealth' | 'checkApiKey'>;
}
