import { loadWorkflows } from '#src/core/compile/load-workflows';
import { targetsOnInstance } from '#src/core/config/project-config';
import { managedIds, presentStableNames, readLock, removedEntries } from '#src/core/lock/lock-file';
import { readStatus } from '#src/core/status/status';
import { StatusPorts, StatusTargetsInput, TargetStatus } from '#src/core/status/status.model';

/**
 * Reads where each workflow of each selected target stands, in turn; a target that cannot be read does not stop the
 * next ones. A lock entry is `removed` when no workflow file of any target on its instance has its stable name (the
 * Removed rule of `presentStableNames` and `removedEntries`). Reads only: it changes nothing.
 */
export async function readStatusTargets({ config, targets, filter }: StatusTargetsInput, { loadWorkflowFiles, lock: store }: StatusPorts): Promise<TargetStatus[]> {
  const statuses: TargetStatus[] = [];
  for (const target of targets) {
    const instance = target.connection.url.value;
    const loaded = loadWorkflows(await loadWorkflowFiles(target.workflows));
    if (!loaded.ok) {
      statuses.push({ kind: 'invalid-files', target, problems: loaded.error });
      continue;
    }
    const lock = await readLock(store);
    if (!lock.ok) {
      statuses.push({ kind: 'invalid-lock-file', target, error: lock.error });
      continue;
    }
    const folders = targetsOnInstance(config, instance).map(({ workflows }) => workflows);
    const present = await presentStableNames(folders, loadWorkflowFiles);
    const report = await readStatus({
      workflows: loaded.value,
      client: target.client,
      managed: managedIds(lock.value, instance),
      removed: removedEntries(lock.value, instance, present),
      filter,
    });
    statuses.push({ kind: 'report', target, report, empty: loaded.value.length === 0 });
  }
  return statuses;
}
