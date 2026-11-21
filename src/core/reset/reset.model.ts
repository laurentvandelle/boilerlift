import { StableName } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_UNREACHABLE } from '#src/core/common/exit-codes';
import { N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';
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
