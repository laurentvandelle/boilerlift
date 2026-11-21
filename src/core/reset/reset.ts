import { StableName } from '#src/core/compile/workflow.model';
import { WorkflowId } from '#src/core/n8n/n8n.model';
import { readStopExitCode, readWorkflowsToRemove } from '#src/core/removal/removal';
import { KeptEntries, PlanResetInput, ResetPlan } from '#src/core/reset/reset.model';

/**
 * Works out what reset would remove on one target, with GET calls only: one per entry, by the id the lock file records
 * (ADR 0009). The lock file is keyed by instance, not by target (ADR 0018): reset removes every entry of the instance
 * but those whose stable name has a file in the folder of another target on it, so the entries of the target's folder
 * and the removed workflows (no file in any folder on the instance) go, and the other targets' deploys stay. It never
 * writes; the removal is `applyRemoval`.
 */
export async function planReset({ client, managed, others, mode }: PlanResetInput): Promise<ResetPlan> {
  const keptNames = new Set(others.flatMap(({ stableNames }) => [...stableNames]));
  const removed = new Map([...managed].filter(([name]) => !keptNames.has(name)));
  const kept = others.map(({ name, stableNames }): KeptEntries => ({ target: name, count: countIn(managed, stableNames) }));
  const read = await readWorkflowsToRemove(client, removed, mode);
  if (!read.ok) {
    return { kind: 'stopped', error: read.error, exitCode: readStopExitCode(read.error) };
  }
  return { kind: 'ready', workflows: read.value, kept };
}

function countIn(managed: Map<StableName, WorkflowId>, stableNames: ReadonlySet<string>): number {
  return [...managed.keys()].filter((name) => stableNames.has(name)).length;
}
