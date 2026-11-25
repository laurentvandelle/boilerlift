import { LoadProblem, LocalWorkflow, StableName, WorkflowFileLoader } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_UNREACHABLE } from '#src/cli/exit-codes';
import { ProjectConfig } from '#src/core/config/config.model';
import { LockFileError, LockReader } from '#src/core/lock/lock-file.model';
import { Result } from '#src/core/common/result';
import { ApiAnswer, ApiFailure, ConnectedTarget, N8nClient, N8nListedWorkflow, N8nWorkflow, WorkflowId } from '#src/core/n8n/n8n.model';

/**
 * Where one workflow stands on the instance. A workflow of the project has one state, the first that holds in this
 * order:
 * - `missing`: the lock file records no id for it, or the recorded id answers 404.
 * - `archived`: it was deleted (archived) in the n8n editor; the next deploy restores it (ADR 0003).
 * - `differs`: its local content and the n8n draft differ (`isSameContent`); the next deploy overwrites the draft.
 * - `draft-pending`: the n8n draft holds the local content, but it is not the published version, or nothing is.
 * - `up-to-date`: the published version holds the local content.
 *
 * An entry of the lock file that no workflow file points to any more, in the folder of any target on the instance, is
 * `removed`: `lift clean` archives it. A workflow of the instance that the lock file does not record is `unmanaged`:
 * status never changes it.
 */
export type WorkflowState = 'missing' | 'archived' | 'differs' | 'draft-pending' | 'up-to-date' | 'removed' | 'unmanaged';

/** A workflow of the project, by its local file. `missing` carries the recorded id that answered 404, if any. */
export type ManagedStatus = { stableName: StableName; path: string; name: string } & (
  | { state: 'missing'; previousId?: WorkflowId }
  | { state: 'archived'; id: WorkflowId }
  | { state: 'differs'; id: WorkflowId }
  | { state: 'draft-pending'; id: WorkflowId }
  | { state: 'up-to-date'; id: WorkflowId }
);

/** An entry of the lock file with no workflow file left: removed from the project. Status does not read it on n8n. */
export interface RemovedStatus {
  state: 'removed';
  stableName: StableName;
  id: WorkflowId;
}

/** A workflow of the instance that the lock file does not record. */
export interface UnmanagedStatus {
  state: 'unmanaged';
  id: WorkflowId;
  name: string;
  isArchived: boolean;
}

export type WorkflowStatus = ManagedStatus | RemovedStatus | UnmanagedStatus;

/** Which workflows status reads and shows: the `--managed` and `--archived` options. */
export interface StatusFilter {
  /** Show the workflows of the project. */
  managed: boolean;
  /** Show the workflows the lock file does not record. */
  unmanaged: boolean;
  /** Also show the unmanaged workflows that are archived. */
  archived: boolean;
}

/**
 * Why status could not read everything, tagged by `kind`: the instance gives no answer or not the n8n public API
 * (`unreachable`), rejects the API key (`key-rejected`), or answers another HTTP error (`read-failed`).
 */
export interface StatusError {
  kind: 'unreachable' | 'key-rejected' | 'read-failed';
  /** The call that failed, for example `GET /api/v1/workflows`. */
  call: string;
  detail: string;
}

/**
 * Where every workflow stands, or why status stopped. Status exits 0 whenever it could read everything, whatever the
 * states. A stopped status carries no workflow.
 */
export type StatusReport =
  | { workflows: WorkflowStatus[]; error?: undefined; exitCode: typeof EXIT_OK }
  | { workflows: []; error: StatusError; exitCode: typeof EXIT_UNREACHABLE | typeof EXIT_API_KEY_REJECTED };

export interface StatusInput {
  workflows: LocalWorkflow[];
  client: N8nClient;
  /** The ids the lock file records for this instance, by stable name (`managedIds`). The only managed workflows. */
  managed: Map<StableName, WorkflowId>;
  /** The entries no workflow file points to any more (`removedEntries`): shown as `removed` with the managed ones. */
  removed: Map<StableName, WorkflowId>;
  filter: StatusFilter;
}

/** One workflow of the project as status read it: with no recorded id, or with the answer to the GET of its id. */
export type ManagedRead =
  | { workflow: LocalWorkflow; id?: undefined }
  | { workflow: LocalWorkflow; id: WorkflowId; draft: Result<ApiAnswer<N8nWorkflow>, ApiFailure> };

/**
 * What status read on the instance, in reading order: the workflows of the project up to the first read that stops
 * status, then the workflow list when the filter shows unmanaged workflows and nothing stopped before it.
 */
export interface StatusReads {
  managed: ManagedRead[];
  listed?: Result<ApiAnswer<N8nListedWorkflow[]>, ApiFailure>;
}

/**
 * What status read on one target, tagged by `kind`:
 * - `invalid-files`: a workflow file of its folder does not load; the instance was not read.
 * - `invalid-lock-file`: the lock file cannot be read; the instance was not read.
 * - `report`: where each workflow stands, or the read that stopped it. `empty`: the folder holds no workflow file.
 */
export type TargetStatus =
  | { kind: 'invalid-files'; target: ConnectedTarget; problems: LoadProblem[] }
  | { kind: 'invalid-lock-file'; target: ConnectedTarget; error: LockFileError }
  | { kind: 'report'; target: ConnectedTarget; report: StatusReport; empty: boolean };

export interface StatusTargetsInput {
  config: ProjectConfig;
  /** The selected targets, in the order status reads them. */
  targets: readonly ConnectedTarget[];
  filter: StatusFilter;
}

/** The ports status reads the project through. It never writes. */
export interface StatusPorts {
  loadWorkflowFiles: WorkflowFileLoader;
  lock: LockReader;
}
