import { planClean } from '#src/core/clean/clean';
import { CleanPorts, CleanRun, CleanTargetsInput, TargetCleanPlan, TargetCleaned } from '#src/core/clean/clean.model';
import { everyTargetReady } from '#src/core/common/every-target-ready';
import { ProjectConfig } from '#src/core/config/config.model';
import { targetsOnInstance } from '#src/core/config/project-config';
import { lockRemover, managedIds, presentStableNames, readLock, removedEntries } from '#src/core/lock/lock-file';
import { LockFile, LockStore } from '#src/core/lock/lock-file.model';
import { ConnectedTarget } from '#src/core/n8n/n8n.model';
import { applyRemoval } from '#src/core/removal/removal';
import { RemovalMode } from '#src/core/removal/removal.model';

/**
 * Reads the lock file, then every selected target, and says what clean does next. Every target is read before anything
 * is removed: if a read stops on one, nothing is removed on any target (`held-back`). A removed workflow is one whose
 * stable name no workflow file of any target on its instance has any more (ADR 0016). Reads only.
 */
export async function planCleanTargets({ config, targets, mode }: CleanTargetsInput, { loadWorkflowFiles, lock: store }: CleanPorts): Promise<CleanRun> {
  const lock = await readLock(store);
  if (!lock.ok) {
    return { kind: 'invalid-lock-file', error: lock.error };
  }
  const plans: TargetCleanPlan[] = [];
  for (const target of targets) {
    plans.push(await planTarget(target, config, lock.value, mode, { loadWorkflowFiles, lock: store }));
  }
  const ready = everyTargetReady(plans);
  if (!ready.ok) {
    return { kind: 'held-back', plans: ready.error };
  }
  return ready.value.every(({ groups }) => groups.removed.length === 0)
    ? { kind: 'nothing-to-remove', ready: ready.value }
    : { kind: 'needs-confirmation', ready: ready.value, lock: lock.value };
}

/**
 * Archives, or deletes in `delete` mode, the removed workflows of each ready target, in order, and drops each entry
 * from the lock file it was read from, saved through `store` after each one.
 */
export async function applyCleanTargets(
  { ready, lock }: Extract<CleanRun, { kind: 'needs-confirmation' }>,
  store: LockStore,
): Promise<TargetCleaned[]> {
  const remover = lockRemover(lock, (text) => store.write(text));
  const cleaned: TargetCleaned[] = [];
  for (const plan of ready) {
    cleaned.push({ plan, report: await applyRemoval(plan.groups.removed, plan.target.client, plan.target.connection.url.value, remover) });
  }
  return cleaned;
}

/**
 * The confirmation rule of clean: `y` or `yes`, in any case, archives (or deletes). Enter, any other answer, or a closed
 * stdin (`undefined`), is a no. The default is no, since clean takes workflows off the instance.
 */
export function isCleanConfirmed(answer: string | undefined): boolean {
  const word = answer?.trim().toLowerCase();
  return word === 'y' || word === 'yes';
}

/** Reads the files of every folder on the instance of `target`, and the instance, and works out its three groups. */
async function planTarget(
  target: ConnectedTarget,
  config: ProjectConfig,
  lock: LockFile,
  mode: RemovalMode,
  { loadWorkflowFiles }: CleanPorts,
): Promise<TargetCleanPlan> {
  const instance = target.connection.url.value;
  const present = await presentStableNames(foldersOn(config, instance), loadWorkflowFiles);
  const files = (await loadWorkflowFiles(target.workflows)).map(({ path }) => path);
  const plan = await planClean({ client: target.client, managed: managedIds(lock, instance), removed: removedEntries(lock, instance, present), files, mode });
  return plan.kind === 'stopped' ? { kind: 'stopped', target, plan } : { kind: 'ready', target, groups: plan };
}

function foldersOn(config: ProjectConfig, instance: string): string[] {
  return targetsOnInstance(config, instance).map(({ workflows }) => workflows);
}

