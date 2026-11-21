import { CleanPlan, NotDeployedWorkflow, PlanCleanInput, UnmanagedWorkflow } from '#src/core/clean/clean.model';
import { baseNameOf, isStableName } from '#src/core/compile/load-workflows';
import { WorkflowId } from '#src/core/n8n/n8n.model';
import { describeReadFailure, readStopExitCode, readWorkflowsToRemove } from '#src/core/removal/removal';
import { RemovalReadError } from '#src/core/removal/removal.model';

/**
 * Works out what clean would do on one target, with GET calls only: one per removed workflow, by the id the lock file
 * records (ADR 0009), then every page of the workflow list for the ones it does not record. It never writes. The first
 * failed call stops the plan. In `delete` mode, every removed workflow still on the instance is `to-delete`. The
 * removal itself is `applyRemoval` (`core/removal/`).
 */
export async function planClean({ client, managed, removed, files, mode }: PlanCleanInput): Promise<CleanPlan> {
  const found = await readWorkflowsToRemove(client, removed, mode);
  if (!found.ok) {
    return stopped(found.error);
  }
  const listed = await client.listWorkflows();
  if (!listed.ok) {
    return stopped(describeReadFailure(listed.error));
  }
  const recorded = new Set<WorkflowId>(managed.values());
  const unmanaged = listed.value.body
    .filter(({ id, isArchived }) => !recorded.has(id) && !isArchived)
    .map(({ id, name }): UnmanagedWorkflow => ({ id, name }));
  const notDeployed = [...files]
    .flatMap((path): NotDeployedWorkflow[] => {
      const stableName = baseNameOf(path);
      return isStableName(stableName) && !managed.has(stableName) ? [{ stableName, path }] : [];
    })
    .sort((a, b) => a.stableName.localeCompare(b.stableName));
  return { kind: 'ready', removed: found.value, notDeployed, unmanaged };
}

function stopped(error: RemovalReadError): CleanPlan {
  return { kind: 'stopped', error, exitCode: readStopExitCode(error) };
}
