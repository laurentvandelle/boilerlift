import { StableName } from '#src/core/compile/workflow.model';
import { WorkflowId } from '#src/core/n8n/n8n.model';

/**
 * What a removal does with the managed workflows still on the instance: `archive` them (the default, recoverable), or
 * `delete` them for good (`--delete`), archiving each one first. Clean and reset share it.
 */
export type RemovalMode = 'archive' | 'delete';

/**
 * A managed workflow clean or reset removes, by the id the lock file records. Where it stands on n8n, from reads only:
 * - `to-archive`: it is on the instance and not archived. The removal archives it.
 * - `already-archived`: it is archived already. The removal only drops its lock entry.
 * - `to-delete` (`delete` mode only): it is on the instance, archived (`isArchived`) or not. The removal archives it
 *   when it is not, then deletes it for good.
 * - `not-found`: its recorded id answers 404. The removal only drops its lock entry.
 */
export type WorkflowToRemove = { stableName: StableName; id: WorkflowId } & (
  | { state: 'to-archive'; name: string }
  | { state: 'already-archived'; name: string }
  | { state: 'to-delete'; name: string; isArchived: boolean }
  | { state: 'not-found' }
);

/**
 * Why a removal could not read the instance, tagged by `kind`: no answer or not the n8n public API (`unreachable`), the
 * API key is rejected (`key-rejected`), or another HTTP error (`read-failed`).
 */
export interface RemovalReadError {
  kind: 'unreachable' | 'key-rejected' | 'read-failed';
  /** The call that failed, for example `GET /api/v1/workflows/abc`. */
  call: string;
  detail: string;
}

/** Why n8n refused or missed one write: the causes a write on one workflow can fail with. */
export type RemovalWriteCause = 'unreachable' | 'key-rejected' | 'scope-missing' | 'rejected';

/**
 * Why one workflow was not removed, tagged by `kind`: no answer (`unreachable`), the API key is rejected
 * (`key-rejected`, 401), the key lacks the `workflow:delete` scope (`scope-missing`, 403), n8n answered another error
 * (`rejected`), the delete failed after the archive went through (`delete-failed`, with its `cause`: the workflow stays
 * archived), or the lock file could not be written after the archive or the delete (`lock-write-failed`). The lock
 * entry stays in every case.
 */
export type RemovalFailure = {
  /** The call that failed, for example `POST /api/v1/workflows/abc/archive`. */
  call: string;
  detail: string;
} & ({ kind: RemovalWriteCause | 'lock-write-failed' } | { kind: 'delete-failed'; cause: RemovalWriteCause });

/**
 * What the removal did with one workflow. `archived`, `already-archived`, `deleted` and `not-found` dropped its lock
 * entry; `failed` kept it.
 */
export type RemovalResult = { stableName: StableName; id: WorkflowId; name: string | null } & (
  | { action: 'archived' }
  | { action: 'already-archived' }
  | { action: 'deleted' }
  | { action: 'not-found' }
  | { action: 'failed'; error: RemovalFailure }
);

/**
 * What the removal did on one target. Its outcome is `partial` when a workflow failed; the others are still removed.
 */
export interface RemovalReport {
  results: RemovalResult[];
  outcome: 'completed' | 'partial';
}
