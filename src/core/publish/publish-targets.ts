import { loadWorkflows } from '#src/core/compile/load-workflows';
import { everyTargetReady } from '#src/core/common/every-target-ready';
import { managedIds, readLock } from '#src/core/lock/lock-file';
import { ConnectedTarget } from '#src/core/n8n/n8n.model';
import { applyPublish, planPublish } from '#src/core/publish/publish';
import { PublishPorts, PublishRun, PublishTargetsInput, ReadyPublish, TargetPublishPlan, TargetPublished } from '#src/core/publish/publish.model';

/**
 * Reads every selected target, then says what publish does next. Every target is read before anything is published:
 * if one is not ready, nothing is published on any target (`held-back`). Publish asks for a confirmation only when a
 * draft is waiting somewhere (`needs-confirmation`). Reads only.
 */
export async function planPublishTargets({ targets, names }: PublishTargetsInput, ports: PublishPorts): Promise<PublishRun> {
  const plans: TargetPublishPlan[] = [];
  for (const target of targets) {
    plans.push(await planTarget(target, names, ports));
  }
  const ready = everyTargetReady(plans);
  if (!ready.ok) {
    return { kind: 'held-back', plans: ready.error };
  }
  const waiting = ready.value.some(({ workflows }) => workflows.some(({ action }) => action === 'to-publish'));
  return { kind: waiting ? 'needs-confirmation' : 'ready', ready: ready.value };
}

/** Publishes the plan of each ready target, in order. */
export async function applyPublishTargets(ready: readonly ReadyPublish[]): Promise<TargetPublished[]> {
  const published: TargetPublished[] = [];
  for (const { target, workflows } of ready) {
    published.push({ target, report: await applyPublish(workflows, target.client) });
  }
  return published;
}

/**
 * The confirmation rule of publish: Enter (an empty answer), `y` or `yes`, in any case, publishes. Any other answer, or a
 * closed stdin (`undefined`), is a no. The default is yes, since publish only makes reviewed drafts run.
 */
export function isPublishConfirmed(answer: string | undefined): boolean {
  const word = answer?.trim().toLowerCase();
  return word === '' || word === 'y' || word === 'yes';
}

/** Reads the files, the lock file and the instance of one target, and works out what publish would do there. */
async function planTarget(target: ConnectedTarget, names: string[], { loadWorkflowFiles, lock: store }: PublishPorts): Promise<TargetPublishPlan> {
  const loaded = loadWorkflows(await loadWorkflowFiles(target.workflows));
  if (!loaded.ok) {
    return { kind: 'invalid-files', target, problems: loaded.error };
  }
  const lock = await readLock(store);
  if (!lock.ok) {
    return { kind: 'invalid-lock-file', target, error: lock.error };
  }
  const plan = await planPublish({ workflows: loaded.value, client: target.client, managed: managedIds(lock.value, target.connection.url.value), names });
  return plan.kind === 'ready' ? { kind: 'ready', target, workflows: plan.workflows } : { kind: 'not-ready', target, plan };
}
