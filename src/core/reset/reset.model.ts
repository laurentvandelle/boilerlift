import { StableName, WorkflowFileLoader } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_UNREACHABLE } from '#src/cli/exit-codes';
import { ProjectConfig } from '#src/core/config/config.model';
import { LockFile, LockFileError, LockStore } from '#src/core/lock/lock-file.model';
import { ConnectedTarget, N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';
import { RemovalMode, RemovalReadError, WorkflowToRemove } from '#src/core/removal/removal.model';

/** The stable names of the workflow files of another target on the same instance. Reset keeps their entries. */
export interface OtherTarget {
  name: string;
  stableNames: ReadonlySet<string>;
}

/** How many lock entries of the instance belong to another target's folder: reset keeps them. */
export interface KeptEntries {
  target: string;
  count: number;
}

/** What reset removes on the instance and what it keeps, before any read: decided by `decideResetScope`. */
export interface ResetScope {
  /** The entries reset removes: every entry of the instance but those whose file is in another target's folder. */
  removed: Map<StableName, WorkflowId>;
  kept: KeptEntries[];
}

export interface PlanResetInput {
  client: N8nClient;
  /** The ids the lock file records for the instance of the target, by stable name (`managedIds`). */
  managed: Map<StableName, WorkflowId>;
  /** The other targets declared on the same instance, in declaration order, with the files of their folders. */
  others: readonly OtherTarget[];
  /** `delete` plans every workflow still on the instance as `to-delete`, archived or not. */
  mode: RemovalMode;
}

/**
 * What reset found on one target, from reads only: the workflows it removes (the entries of the target's folder and the
 * removed workflows, in stable-name order) and the entries it keeps for each other target on the instance; or the read
 * that stopped it. Nothing is removed on a stopped plan.
 */
export type ResetPlan =
  | { kind: 'ready'; workflows: WorkflowToRemove[]; kept: KeptEntries[] }
  | { kind: 'stopped'; error: RemovalReadError; exitCode: typeof EXIT_UNREACHABLE | typeof EXIT_API_KEY_REJECTED };

/** A reset plan whose reads went through. */
export type ReadyReset = Extract<ResetPlan, { kind: 'ready' }>;

/**
 * What reset found on its target, tagged by `kind`. Nothing is removed yet:
 * - `invalid-lock-file`: the lock file cannot be read; nothing was read on the instance.
 * - `stopped`: a read failed.
 * - `nothing-to-remove`: the plan holds no workflow.
 * - `needs-confirmation`: the plan holds workflows to remove. `lock` is the record they were read from, which
 *   `applyResetTarget` drops their entries from.
 */
export type ResetRun =
  | { kind: 'invalid-lock-file'; error: LockFileError }
  | { kind: 'stopped'; plan: Extract<ResetPlan, { kind: 'stopped' }> }
  | { kind: 'nothing-to-remove'; plan: ReadyReset }
  | { kind: 'needs-confirmation'; plan: ReadyReset; lock: LockFile };

export interface ResetTargetInput {
  config: ProjectConfig;
  /** The one target named with `--target`. */
  target: ConnectedTarget;
  /** `delete` plans every workflow still on the instance as `to-delete`, archived or not. */
  mode: RemovalMode;
}

/** The ports reset reads the project and writes the lock file through. */
export interface ResetPorts {
  loadWorkflowFiles: WorkflowFileLoader;
  lock: LockStore;
}
