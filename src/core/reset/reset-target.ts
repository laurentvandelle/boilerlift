import { WorkflowFileLoader } from '#src/core/compile/workflow.model';
import { ProjectConfig } from '#src/core/config/config.model';
import { targetsOnInstance } from '#src/core/config/project-config';
import { lockRemover, managedIds, presentStableNames, readLock } from '#src/core/lock/lock-file';
import { LockStore } from '#src/core/lock/lock-file.model';
import { ConnectedTarget } from '#src/core/n8n/n8n.model';
import { applyRemoval } from '#src/core/removal/removal';
import { RemovalReport } from '#src/core/removal/removal.model';
import { planReset } from '#src/core/reset/reset';
import { OtherTarget, ResetPorts, ResetRun, ResetTargetInput } from '#src/core/reset/reset.model';

/**
 * Reads the lock file, the folders of the other targets on the instance and the instance, and says what reset does
 * next on its one target (ADR 0018). Reads only.
 */
export async function planResetTarget({ config, target, mode }: ResetTargetInput, { loadWorkflowFiles, lock: store }: ResetPorts): Promise<ResetRun> {
  const lock = await readLock(store);
  if (!lock.ok) {
    return { kind: 'invalid-lock-file', error: lock.error };
  }
  const instance = target.connection.url.value;
  const others = await otherTargets(config, target, loadWorkflowFiles);
  const plan = await planReset({ client: target.client, managed: managedIds(lock.value, instance), others, mode });
  if (plan.kind === 'stopped') {
    return { kind: 'stopped', plan };
  }
  return plan.workflows.length === 0 ? { kind: 'nothing-to-remove', plan } : { kind: 'needs-confirmation', plan, lock: lock.value };
}

/** Archives, or deletes in `delete` mode, every workflow of the plan, and drops each entry from the lock file, saved through `store`. */
export async function applyResetTarget(
  { plan, lock }: Extract<ResetRun, { kind: 'needs-confirmation' }>,
  target: ConnectedTarget,
  store: LockStore,
): Promise<RemovalReport> {
  return applyRemoval(plan.workflows, target.client, target.connection.url.value, lockRemover(lock, (text) => store.write(text)));
}

/**
 * The confirmation rule of reset: only the exact target name, case-sensitive, around spaces, goes on. Any other answer,
 * Enter, or a closed stdin (`undefined`), is a no: reset removes every workflow of a target, so a yes is not enough.
 */
export function isResetConfirmed(answer: string | undefined, target: string): boolean {
  return answer?.trim() === target;
}

/** The other targets declared on the instance of `target`, in declaration order, with the stable names of their folders. */
async function otherTargets(config: ProjectConfig, target: ConnectedTarget, loadWorkflowFiles: WorkflowFileLoader): Promise<OtherTarget[]> {
  const others: OtherTarget[] = [];
  for (const other of targetsOnInstance(config, target.connection.url.value)) {
    if (other.name !== target.name) {
      others.push({ name: other.name, stableNames: await presentStableNames([other.workflows], loadWorkflowFiles) });
    }
  }
  return others;
}
