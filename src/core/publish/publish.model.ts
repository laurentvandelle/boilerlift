import { LoadProblem, LocalWorkflow, StableName, WorkflowFileLoader } from '#src/core/compile/workflow.model';
import { EXIT_OK, EXIT_PARTIAL_FAILURE } from '#src/cli/exit-codes';
import { LockFileError, LockReader } from '#src/core/lock/lock-file.model';
import { ConnectedTarget, N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';
import { StatusError } from '#src/core/status/status.model';

/** The local fields of a workflow of the project, as publish reports it. */
export interface PublishedWorkflow {
  stableName: StableName;
  path: string;
  name: string;
  id: WorkflowId;
}

/**
 * What publish does, or would do, with one workflow of the plan:
 * - `to-publish`: its draft holds the local file and is waiting to be published (`draft-pending`).
 * - `already-published`: a named workflow whose published version already holds the local file (`up-to-date`).
 * - `refused`: a named workflow whose local file differs from the draft (`differs`): deploy it first. The run exits 5.
 * - `differs`: without names, a workflow whose local file differs from the draft, often after a change made in the n8n
 *   editor. It is reported so that it is not left out without a word, never published, and not an error.
 */
export type PlannedPublish = PublishedWorkflow & { action: 'to-publish' | 'already-published' | 'refused' | 'differs' };

/**
 * Why a name given on the command line is unknown on a target, tagged by `reason`: no workflow file has that stable
 * name (`no-file`), the lock file records no id for it or n8n no longer has that id (`not-deployed`), or it is archived
 * in n8n (`archived`). Any unknown name stops publish before anything is asked or published.
 */
export interface UnknownName {
  name: string;
  reason: 'no-file' | 'not-deployed' | 'archived';
}

/**
 * What publish found on one target, from reads only:
 * - `ready`: the workflows of the plan, in stable-name order; empty when nothing is waiting.
 * - `unknown-names`: names that match no deployed workflow. Nothing is published, on any target.
 * - `stopped`: a read failed (status' error). Nothing is published, on any target.
 */
export type PublishPlan =
  | { kind: 'ready'; workflows: PlannedPublish[] }
  | { kind: 'unknown-names'; unknown: UnknownName[] }
  | { kind: 'stopped'; error: StatusError };

export interface PlanPublishInput {
  workflows: LocalWorkflow[];
  client: N8nClient;
  /** The ids the lock file records for this instance, by stable name (`managedIds`). The only workflows publish touches. */
  managed: Map<StableName, WorkflowId>;
  /** The stable names given on the command line. Empty: every workflow whose draft is waiting to be published. */
  names: string[];
}

/**
 * Why n8n did not publish one workflow, tagged by `kind`: no answer or not the n8n public API (`unreachable`), the API
 * key is rejected (`key-rejected`), or n8n answered another error, such as a workflow it cannot publish (`rejected`).
 */
export interface PublishFailure {
  kind: 'unreachable' | 'key-rejected' | 'rejected';
  /** The call that failed, for example `POST /api/v1/workflows/abc/activate`. */
  call: string;
  detail: string;
}

/** What publish did with one workflow of the plan. */
export type PublishResult = PublishedWorkflow &
  (
    | { action: 'published' }
    | { action: 'already-published' }
    | { action: 'refused' }
    | { action: 'differs' }
    | { action: 'failed'; error: PublishFailure }
  );

/**
 * What publish did on one target. It exits 5 when a workflow was refused or failed; the others are still published. A
 * `differs` workflow, found without names, does not change the exit code.
 */
export interface PublishReport {
  results: PublishResult[];
  exitCode: typeof EXIT_OK | typeof EXIT_PARTIAL_FAILURE;
}

/**
 * What publish found on one target, from reads only, tagged by `kind`:
 * - `invalid-files`: a workflow file of its folder does not load.
 * - `invalid-lock-file`: the lock file cannot be read.
 * - `not-ready`: a name is unknown there, or a read failed (`PublishPlan` other than `ready`).
 * - `ready`: the workflows of its plan, in stable-name order; empty when nothing is waiting.
 */
export type TargetPublishPlan =
  | { kind: 'invalid-files'; target: ConnectedTarget; problems: LoadProblem[] }
  | { kind: 'invalid-lock-file'; target: ConnectedTarget; error: LockFileError }
  | { kind: 'not-ready'; target: ConnectedTarget; plan: Exclude<PublishPlan, { kind: 'ready' }> }
  | { kind: 'ready'; target: ConnectedTarget; workflows: PlannedPublish[] };

/** A target whose plan is ready to publish. */
export type ReadyPublish = Extract<TargetPublishPlan, { kind: 'ready' }>;

/**
 * What publish found on every selected target, tagged by `kind`. Nothing is published yet:
 * - `held-back`: at least one target is not ready, so nothing is published on any target. Every plan, in order.
 * - `needs-confirmation`: every target is ready and a draft waits to be published: publish asks first.
 * - `ready`: every target is ready and no draft waits: publish reports without asking.
 */
export type PublishRun =
  | { kind: 'held-back'; plans: TargetPublishPlan[] }
  | { kind: 'needs-confirmation'; ready: ReadyPublish[] }
  | { kind: 'ready'; ready: ReadyPublish[] };

export interface PublishTargetsInput {
  /** The selected targets, in the order publish reads them. */
  targets: readonly ConnectedTarget[];
  /** The stable names given on the command line. Empty: every workflow whose draft is waiting to be published. */
  names: string[];
}

/** The ports publish reads the project through. It never writes the lock file. */
export interface PublishPorts {
  loadWorkflowFiles: WorkflowFileLoader;
  lock: LockReader;
}

/** What publish did on one target. */
export interface TargetPublished {
  target: ConnectedTarget;
  report: PublishReport;
}
