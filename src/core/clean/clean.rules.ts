import { CleanGroups, NotDeployedWorkflow, PlanCleanInput, UnmanagedWorkflow } from '#src/core/clean/clean.model';
import { baseNameOf, isStableName } from '#src/core/compile/load-workflows';
import { N8nListedWorkflow, WorkflowId } from '#src/core/n8n/n8n.model';
import { WorkflowToRemove } from '#src/core/removal/removal.model';

/**
 * Sorts what clean read into its three groups: the removed workflows as read, the workflow files with no lock entry
 * (not deployed yet), by stable name, and the workflows of the instance the lock file does not record, archived ones
 * left out, in the order n8n lists them.
 */
export function decideCleanGroups(
  { managed, files }: Pick<PlanCleanInput, 'managed' | 'files'>,
  removed: WorkflowToRemove[],
  listed: readonly N8nListedWorkflow[],
): CleanGroups {
  const recorded = new Set<WorkflowId>(managed.values());
  const unmanaged = listed
    .filter(({ id, isArchived }) => !recorded.has(id) && !isArchived)
    .map(({ id, name }): UnmanagedWorkflow => ({ id, name }));
  const notDeployed = [...files]
    .flatMap((path): NotDeployedWorkflow[] => {
      const stableName = baseNameOf(path);
      return isStableName(stableName) && !managed.has(stableName) ? [{ stableName, path }] : [];
    })
    .sort((a, b) => a.stableName.localeCompare(b.stableName));
  return { removed, notDeployed, unmanaged };
}
