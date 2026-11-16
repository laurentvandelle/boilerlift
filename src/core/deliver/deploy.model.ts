import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { N8nClient } from '#src/core/n8n/n8n.model';

export type DeployAction = 'created' | 'updated' | 'skipped' | 'restored' | 'failed' | 'not-processed';

/** Why one workflow failed. */
export interface WorkflowError {
  /** The call that failed, for example `PUT /api/v1/workflows/abc`. */
  call: string;
  detail: string;
  /** The next step for the user. */
  hint: string;
}

export interface DeployResult {
  stableName: string;
  path: string;
  action: DeployAction;
  /** The workflow id on the instance. Absent when a failed or not-processed workflow has none yet. */
  id?: string;
  name: string;
  /** Set when `action` is `failed`. */
  error?: WorkflowError;
}

/** A failure that stopped the whole run. */
export interface DeployError extends WorkflowError {
  exitCode: number;
}

export interface DeployReport {
  /** Every local workflow, in stable-name order. Empty when the run stopped before any workflow. */
  results: DeployResult[];
  /** Things that went through but that the user should know about. */
  warnings: string[];
  /** Set only when a failure stopped the whole run. */
  error?: DeployError;
  exitCode: number;
}

export interface DeployInput {
  workflows: LocalWorkflow[];
  client: N8nClient;
}
