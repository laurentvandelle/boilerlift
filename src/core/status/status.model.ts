import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_UNREACHABLE } from '#src/core/common/exit-codes';
import { N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';

/**
 * Where one workflow stands on the instance. A workflow of the project has one state, the first that holds in this
 * order:
 * - `missing`: the lock file records no id for it, or the recorded id answers 404.
 * - `archived`: it was deleted (archived) in the n8n editor; the next deploy restores it (ADR 0003).
 * - `differs`: its local content and the n8n draft differ (`isSameContent`); the next deploy overwrites the draft.
 * - `draft-pending`: the n8n draft holds the local content, but it is not the published version, or nothing is.
 * - `up-to-date`: the published version holds the local content.
 *
 * A workflow of the instance that the lock file does not record is `unmanaged`: status never changes it.
 */
export type WorkflowState = 'missing' | 'archived' | 'differs' | 'draft-pending' | 'up-to-date' | 'unmanaged';

/** A workflow of the project, by its local file. `missing` carries the recorded id that answered 404, if any. */
export type ManagedStatus = { stableName: StableName; path: string; name: string } & (
  | { state: 'missing'; previousId?: WorkflowId }
  | { state: 'archived'; id: WorkflowId }
  | { state: 'differs'; id: WorkflowId }
  | { state: 'draft-pending'; id: WorkflowId }
  | { state: 'up-to-date'; id: WorkflowId }
);

/** A workflow of the instance that the lock file does not record. */
export interface UnmanagedStatus {
  state: 'unmanaged';
  id: WorkflowId;
  name: string;
  isArchived: boolean;
}

export type WorkflowStatus = ManagedStatus | UnmanagedStatus;

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
  filter: StatusFilter;
}
