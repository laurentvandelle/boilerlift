import { StableName } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_UNREACHABLE } from '#src/core/common/exit-codes';
import { N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';
import { RemovalMode, RemovalReadError, WorkflowToRemove } from '#src/core/removal/removal.model';

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
  | { kind: 'stopped'; error: RemovalReadError; exitCode: typeof EXIT_UNREACHABLE | typeof EXIT_API_KEY_REJECTED };

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
