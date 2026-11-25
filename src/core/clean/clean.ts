import { CleanPlan, PlanCleanInput } from '#src/core/clean/clean.model';
import { decideCleanGroups } from '#src/core/clean/clean.rules';
import { describeReadFailure, readWorkflowsToRemove } from '#src/core/removal/removal';
import { RemovalReadError } from '#src/core/removal/removal.model';

/**
 * Works out what clean would do on one target, with GET calls only: one per removed workflow, by the id the lock file
 * records (ADR 0009), then every page of the workflow list for the ones it does not record. It never writes. The first
 * failed call stops the plan. In `delete` mode, every removed workflow still on the instance is `to-delete`. The groups
 * are decided by `decideCleanGroups` (`clean.rules.ts`); the removal itself is `applyRemoval` (`core/removal/`).
 */
export async function planClean(input: PlanCleanInput): Promise<CleanPlan> {
  const { client, removed, mode } = input;
  const found = await readWorkflowsToRemove(client, removed, mode);
  if (!found.ok) {
    return stopped(found.error);
  }
  const listed = await client.listWorkflows();
  if (!listed.ok) {
    return stopped(describeReadFailure(listed.error));
  }
  return { kind: 'ready', ...decideCleanGroups(input, found.value, listed.value.body) };
}

function stopped(error: RemovalReadError): CleanPlan {
  return { kind: 'stopped', error };
}
