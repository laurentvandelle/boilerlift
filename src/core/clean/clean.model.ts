import { StableName, WorkflowFileLoader } from '#src/core/compile/workflow.model';
import { ProjectConfig } from '#src/core/config/config.model';
import { LockFile, LockFileError, LockStore } from '#src/core/lock/lock-file.model';
import { ConnectedTarget, N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';
import { RemovalMode, RemovalReadError, RemovalReport, WorkflowToRemove } from '#src/core/removal/removal.model';

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
  /** The removed workflows: the entries no workflow file of any target on the instance points to any more. */
  removed: WorkflowToRemove[];
  notDeployed: NotDeployedWorkflow[];
  unmanaged: UnmanagedWorkflow[];
}

/** What clean found on one target: its groups, or the read that stopped it. Nothing is archived on a stopped plan. */
export type CleanPlan =
  | ({ kind: 'ready' } & CleanGroups)
  | { kind: 'stopped'; error: RemovalReadError };

export interface PlanCleanInput {
  client: N8nClient;
  /** The ids the lock file records for this instance, by stable name (`managedIds`). The only workflows clean touches. */
  managed: Map<StableName, WorkflowId>;
  /** The entries of `managed` that no workflow file points to any more (`removedEntries`). */
  removed: Map<StableName, WorkflowId>;
  /** The paths of the workflow files of this target: the ones whose stable name has no lock entry are not deployed yet. */
  files: readonly string[];
  /** `delete` plans every removed workflow still on the instance as `to-delete`, archived or not. */
  mode: RemovalMode;
}

/** What clean found on one target, from reads only: its groups, or the read that stopped it. */
export type TargetCleanPlan =
  | { kind: 'stopped'; target: ConnectedTarget; plan: Extract<CleanPlan, { kind: 'stopped' }> }
  | { kind: 'ready'; target: ConnectedTarget; groups: CleanGroups };

/** A target whose reads went through, with its groups. */
export type ReadyClean = Extract<TargetCleanPlan, { kind: 'ready' }>;

/**
 * What clean found on every selected target, tagged by `kind`. Nothing is removed yet:
 * - `invalid-lock-file`: the lock file cannot be read; no target was read.
 * - `held-back`: a read stopped on at least one target, so nothing is removed on any target. Every plan, in order.
 * - `nothing-to-remove`: every target is ready and none has a removed workflow.
 * - `needs-confirmation`: every target is ready and at least one has removed workflows. `lock` is the record they were
 *   read from, which `applyCleanTargets` drops their entries from.
 */
export type CleanRun =
  | { kind: 'invalid-lock-file'; error: LockFileError }
  | { kind: 'held-back'; plans: TargetCleanPlan[] }
  | { kind: 'nothing-to-remove'; ready: ReadyClean[] }
  | { kind: 'needs-confirmation'; ready: ReadyClean[]; lock: LockFile };

export interface CleanTargetsInput {
  config: ProjectConfig;
  /** The selected targets, in the order clean reads them. */
  targets: readonly ConnectedTarget[];
  /** `delete` plans every removed workflow still on the instance as `to-delete`, archived or not. */
  mode: RemovalMode;
}

/** The ports clean reads the project and writes the lock file through. */
export interface CleanPorts {
  loadWorkflowFiles: WorkflowFileLoader;
  lock: LockStore;
}

/** What clean did on one target: its plan and the removal of its removed workflows. */
export interface TargetCleaned {
  plan: ReadyClean;
  report: RemovalReport;
}
