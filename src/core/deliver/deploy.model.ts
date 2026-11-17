import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { EXIT_OK, EXIT_PARTIAL_FAILURE, ExitCode } from '#src/core/common/exit-codes';
import { N8nClient, N8nTag, WorkflowId } from '#src/core/n8n/n8n.model';

export type DeployAction = 'created' | 'updated' | 'skipped' | 'restored' | 'failed' | 'not-processed';

/** Why one workflow failed. */
export interface WorkflowError {
  /** The call that failed, for example `PUT /api/v1/workflows/abc`. */
  call: string;
  detail: string;
  /** The next step for the user. */
  hint: string;
}

/** An action on an existing workflow of the instance: it carries the id of that workflow. */
type TargetAction =
  | { action: 'updated'; id: WorkflowId }
  | { action: 'skipped'; id: WorkflowId }
  | { action: 'restored'; id: WorkflowId };

/** A failed workflow carries its error, and the id of its target when it had one. */
type FailedAction = { action: 'failed'; id?: WorkflowId; error: WorkflowError };

/**
 * The action a plan takes on one workflow, and what it carries. A `created` step has no id yet, and a
 * `not-processed` step nothing: a failure stopped the run first.
 */
export type PlannedAction = { action: 'created' } | TargetAction | FailedAction | { action: 'not-processed' };

/** The action a report shows for one workflow. A real deploy gives a created workflow its new id; a dry run has none. */
export type ResultAction = { action: 'created'; id?: WorkflowId } | TargetAction | FailedAction | { action: 'not-processed' };

/** One workflow in a report. */
export type DeployResult = {
  stableName: StableName;
  path: string;
  name: string;
} & ResultAction;

/**
 * What went wrong with a deploy, tagged by `kind`. `effectOf` in deploy-failure.ts derives from the kind whether it
 * stops the run and its exit code.
 * - `unreachable`: the instance gives no answer, or an answer that is not the n8n public API. Stops the run.
 * - `key-rejected`: the instance rejects the API key. Stops the run.
 * - `drafts-unsupported`: the instance is older than MIN_N8N_VERSION. Stops the run before any write.
 * - `workflow-failed`: one workflow failed; the others are still delivered.
 */
export type DeployErrorKind = 'unreachable' | 'key-rejected' | 'drafts-unsupported' | 'workflow-failed';

export interface DeployError extends WorkflowError {
  kind: DeployErrorKind;
}

/**
 * Something that went through but that the user should know about. It is data: the deploy command words it as what
 * deploy did, or for a dry run as what deploy would do.
 * - `archived-copies`: archived workflows still carry the stable tag of the live workflow that deploy uses.
 * - `restored`: only an archived workflow carries the stable tag, and deploy restores it as an unpublished draft.
 * - `several-archived`: several archived workflows, and no live one, carry the stable tag; deploy restores the first.
 */
export type DeployWarning =
  | { kind: 'archived-copies'; stableName: StableName; archivedIds: WorkflowId[]; liveId: WorkflowId }
  | { kind: 'restored'; stableName: StableName; id: WorkflowId }
  | { kind: 'several-archived'; stableName: StableName; archivedIds: WorkflowId[]; restoredId: WorkflowId };

/**
 * How a run ended. A run that went to the end exits 0, or 5 when a workflow failed. A run stopped by a failure
 * carries it, and exits with its code.
 */
export type RunEnd =
  | { error?: undefined; exitCode: typeof EXIT_OK | typeof EXIT_PARTIAL_FAILURE }
  | { error: DeployError; exitCode: ExitCode };

export type DeployReport = {
  /** Every local workflow, in stable-name order. Empty when the run stopped before any workflow. */
  results: DeployResult[];
  warnings: DeployWarning[];
} & RunEnd;

export interface DeployInput {
  workflows: LocalWorkflow[];
  client: N8nClient;
}

/** One workflow in a deploy plan: the action a deploy would take, and what apply needs to take it. */
export type PlannedStep = { workflow: LocalWorkflow } & PlannedAction;

/** What a deploy would do, computed from reads only. A dry run renders it; a real deploy applies it. */
export type DeployPlan = {
  /** Every local workflow, in stable-name order. Empty when the plan stopped before any workflow. */
  steps: PlannedStep[];
  warnings: DeployWarning[];
  /** The instance tag list, read once when at least one workflow is created. */
  tags?: N8nTag[];
} & RunEnd;
