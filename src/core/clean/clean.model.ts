import { StableName } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_PARTIAL_FAILURE, EXIT_UNREACHABLE } from '#src/core/common/exit-codes';
import { N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';

/**
 * A workflow removed from the project: the lock file records it for the instance, but no workflow file of any target
 * on that instance has its stable name any more. Where it stands on n8n, from reads only:
 * - `to-archive`: it is on the instance and not archived. Clean archives it.
 * - `already-archived`: it is archived already. Clean only drops its lock entry.
 * - `not-found`: its recorded id answers 404. Clean only drops its lock entry.
 */
export type RemovedWorkflow = { stableName: StableName; id: WorkflowId } & (
  | { state: 'to-archive'; name: string }
  | { state: 'already-archived'; name: string }
  | { state: 'not-found' }
);

/** A workflow file of the target with no lock entry for its instance: `lift deploy` creates it. Clean never touches it. */
export interface NotDeployedWorkflow {
  stableName: StableName;
  path: string;
}

/** A workflow of the instance, not archived, that the lock file does not record. Clean shows it and never touches it. */
export interface UnmanagedWorkflow {
  id: WorkflowId;
  name: string;
}

/** The three groups clean lists for one target, each in a stable order. */
export interface CleanGroups {
  removed: RemovedWorkflow[];
  notDeployed: NotDeployedWorkflow[];
  unmanaged: UnmanagedWorkflow[];
}

/**
 * Why clean could not read the instance, tagged by `kind`: no answer or not the n8n public API (`unreachable`), the API
 * key is rejected (`key-rejected`), or another HTTP error (`read-failed`).
 */
export interface CleanReadError {
  kind: 'unreachable' | 'key-rejected' | 'read-failed';
  /** The call that failed, for example `GET /api/v1/workflows/abc`. */
  call: string;
  detail: string;
}

/** What clean found on one target: its groups, or the read that stopped it. Nothing is archived on a stopped plan. */
export type CleanPlan =
  | ({ kind: 'ready' } & CleanGroups)
  | { kind: 'stopped'; error: CleanReadError; exitCode: typeof EXIT_UNREACHABLE | typeof EXIT_API_KEY_REJECTED };

export interface PlanCleanInput {
  client: N8nClient;
  /** The ids the lock file records for this instance, by stable name (`managedIds`). The only workflows clean touches. */
  managed: Map<StableName, WorkflowId>;
  /** The entries of `managed` that no workflow file points to any more (`removedEntries`). */
  removed: Map<StableName, WorkflowId>;
  /** The paths of the workflow files of this target: the ones whose stable name has no lock entry are not deployed yet. */
  files: readonly string[];
}

/**
 * Why one workflow was not cleaned, tagged by `kind`: no answer (`unreachable`), the API key is rejected (`key-rejected`,
 * 401), the key lacks the `workflow:delete` scope (`scope-missing`, 403), n8n answered another error (`rejected`), or
 * the lock file could not be written after the archive (`lock-write-failed`). The lock entry stays in every case.
 */
export interface CleanFailure {
  kind: 'unreachable' | 'key-rejected' | 'scope-missing' | 'rejected' | 'lock-write-failed';
  /** The call that failed, for example `POST /api/v1/workflows/abc/archive`. */
  call: string;
  detail: string;
}

/**
 * What clean did with one removed workflow. `archived`, `already-archived` and `not-found` dropped its lock entry;
 * `failed` kept it.
 */
export type CleanResult = { stableName: StableName; id: WorkflowId; name: string | null } & (
  | { action: 'archived' }
  | { action: 'already-archived' }
  | { action: 'not-found' }
  | { action: 'failed'; error: CleanFailure }
);

/** What clean did on one target. It exits 5 when a workflow failed; the others are still cleaned. */
export interface CleanReport {
  results: CleanResult[];
  exitCode: typeof EXIT_OK | typeof EXIT_PARTIAL_FAILURE;
}
