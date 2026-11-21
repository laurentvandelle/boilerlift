import { CredentialEntry, MissingCredential } from '#src/core/compile/credential.model';
import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { EXIT_OK, EXIT_PARTIAL_FAILURE, ExitCode } from '#src/core/common/exit-codes';
import { N8nClient, N8nTag, WorkflowId } from '#src/core/n8n/n8n.model';

export type DeployAction = 'created' | 'recreated' | 'updated' | 'skipped' | 'restored' | 'failed' | 'not-processed';

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
 * The action a plan takes on one workflow, and what it carries. A `created` step has no id yet. A `recreated` step
 * carries the recorded id that the instance no longer knows (404). A `not-processed` step carries nothing: a failure
 * stopped the run first.
 */
export type PlannedAction =
  | { action: 'created' }
  | { action: 'recreated'; previousId: WorkflowId }
  | TargetAction
  | FailedAction
  | { action: 'not-processed' };

/**
 * The action a report shows for one workflow. A real deploy gives a created or recreated workflow its new id; a dry
 * run has none.
 */
export type ResultAction =
  | { action: 'created'; id?: WorkflowId }
  | { action: 'recreated'; previousId: WorkflowId; id?: WorkflowId }
  | TargetAction
  | FailedAction
  | { action: 'not-processed' };

/** One workflow in a report. */
export type DeployResult = {
  stableName: StableName;
  path: string;
  name: string;
} & ResultAction;

/**
 * What went wrong with a deploy, tagged by `kind`. `EFFECTS` in deploy-failure.ts derives from the kind whether it
 * stops the run and its exit code.
 * - `unreachable`: the instance gives no answer, or an answer that is not the n8n public API. Stops the run.
 * - `key-rejected`: the instance rejects the API key. Stops the run.
 * - `drafts-unsupported`: the instance is older than MIN_N8N_VERSION. Stops the run before any write.
 * - `credential-scope-missing`: workflows use `credential()`, and the API key cannot list the credentials (403).
 *   Stops the run before any write.
 * - `credentials-missing`: workflows use credentials the target does not provide. Stops the run before any write.
 * - `workflow-failed`: one workflow failed; the others are still delivered.
 * - `lock-write-failed`: a workflow was created, but its id could not be recorded in the lock file. Stops the run.
 */
export type DeployErrorKind =
  | 'unreachable'
  | 'key-rejected'
  | 'drafts-unsupported'
  | 'credential-scope-missing'
  | 'credentials-missing'
  | 'workflow-failed'
  | 'lock-write-failed';

/**
 * Why a credential the workflows use is missing on the target:
 * - `not-listed`: its key is not in `credentials/<target>.ts`.
 * - `gone`: the list has it, but the instance no longer has its id.
 * - `type-changed`: the instance has its id under another type than the list says.
 */
export type MissingReason = 'not-listed' | 'gone' | 'type-changed';

/** A credential the workflows of the target use and that the target does not provide, and why. */
export interface UnresolvedCredential extends MissingCredential {
  reason: MissingReason;
  /** The id the list gives it; absent when the list does not have the key. */
  id?: string;
}

/** A deploy error. `credentials-missing` also carries each missing credential, sorted by key. */
export type DeployError =
  | (WorkflowError & { kind: Exclude<DeployErrorKind, 'credentials-missing'> })
  | (WorkflowError & { kind: 'credentials-missing'; missing: UnresolvedCredential[] });

/**
 * Something that went through but that the user should know about. It is data: the deploy command words it as what
 * deploy did, or for a dry run as what deploy would do.
 * - `restored`: the recorded workflow was archived in n8n, and deploy restores it as an unpublished draft.
 * - `tag-failed`: the workflow was delivered, but the target tag `tag` could not be found, created or added to it:
 *   `call` failed with `detail`. It changes neither the action nor the exit code.
 */
export type DeployWarning =
  | { kind: 'restored'; stableName: StableName; id: WorkflowId }
  | { kind: 'tag-failed'; stableName: StableName; tag: string; call: string; detail: string };

/**
 * The target tag of a report: its name, and how many workflows received it, or for a dry run would receive it. A
 * workflow that already has it does not count.
 */
export interface TargetTagStatus {
  name: string;
  added: number;
}

/**
 * How a run ended. A run that went to the end exits 0, or 5 when a workflow failed. A run stopped by a failure
 * carries it, and exits with its code.
 */
export type RunEnd =
  | { error?: undefined; exitCode: typeof EXIT_OK | typeof EXIT_PARTIAL_FAILURE }
  | { error: DeployError; exitCode: ExitCode };

/**
 * The lock file of a report. `changed` is true when deploy wrote it, or for a dry run when deploy would write it:
 * some workflow is created or recreated.
 */
export interface LockFileStatus {
  path: string;
  changed: boolean;
}

export type DeployReport = {
  /** Every local workflow, in stable-name order. Empty when the run stopped before any workflow. */
  results: DeployResult[];
  warnings: DeployWarning[];
  lockFile: LockFileStatus;
  /** Absent when the target turns the tag off. */
  tag?: TargetTagStatus;
} & RunEnd;

export interface DeployInput {
  workflows: LocalWorkflow[];
  client: N8nClient;
  /** The ids the lock file records for this instance, by stable name (`managedIds`). The only managed workflows. */
  managed: Map<StableName, WorkflowId>;
  /** The target tag to add to every delivered workflow: the target's name. Absent when the target turns it off. */
  targetTag?: string;
  /** The name of the target: the hints name it. */
  target: string;
  /**
   * The credential list of the target (`credentials/<target>.ts`), through which each `credential()` marker resolves.
   * Empty when the project has none.
   */
  credentials: readonly CredentialEntry[];
}

/** One workflow in a deploy plan: the action a deploy would take, and what apply needs to take it. */
export type PlannedStep = { workflow: LocalWorkflow } & PlannedAction;

/** What a deploy would do, computed from reads only. A dry run renders it; a real deploy applies it. */
export type DeployPlan = {
  /** Every local workflow, in stable-name order. Empty when the plan stopped before any workflow. */
  steps: PlannedStep[];
  warnings: DeployWarning[];
  /** The tags each workflow the plan read has on the instance, by stable name. A workflow it did not read has none. */
  tags: Map<StableName, N8nTag[]>;
} & RunEnd;
