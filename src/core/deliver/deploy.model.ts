import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { N8nClient, N8nTag } from '#src/core/n8n/n8n.model';

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

/** One workflow in a deploy plan: the action a deploy would take, and what apply needs to take it. */
export interface PlannedStep {
  workflow: LocalWorkflow;
  action: DeployAction;
  /** The target workflow id on the instance. Absent for a create, or a failure with no target yet. */
  id?: string;
  /** Set when `action` is `failed`. */
  error?: WorkflowError;
}

/** What a deploy would do, computed from reads only. A dry run renders it; a real deploy applies it. */
export interface DeployPlan {
  /** Every local workflow, in stable-name order. Empty when the plan stopped before any workflow. */
  steps: PlannedStep[];
  warnings: string[];
  /** The instance tag list, read once when at least one workflow is created. */
  tags?: N8nTag[];
  /** Set only when a failure stopped the plan. */
  error?: DeployError;
  exitCode: number;
}

/** How warnings are worded: a dry run says what deploy would do, a deploy says what it did. */
export type PlanMode = 'dry-run' | 'deploy';
