import { StableName } from '#src/core/compile/workflow.model';
import { WorkflowId } from '#src/core/n8n/n8n.model';
import { KeptEntries, OtherTarget, ResetScope } from '#src/core/reset/reset.model';

/**
 * Decides which entries of the instance reset removes (ADR 0018): every one but those whose stable name has a file in
 * the folder of another target on the instance, so the entries of the target's folder and the removed workflows go.
 * It counts, per other target and in their order, the entries it keeps for that target.
 */
export function decideResetScope(managed: ReadonlyMap<StableName, WorkflowId>, others: readonly OtherTarget[]): ResetScope {
  const keptNames = new Set(others.flatMap(({ stableNames }) => [...stableNames]));
  const removed = new Map([...managed].filter(([name]) => !keptNames.has(name)));
  const kept = others.map(({ name, stableNames }): KeptEntries => ({ target: name, count: countIn(managed, stableNames) }));
  return { removed, kept };
}

function countIn(managed: ReadonlyMap<StableName, WorkflowId>, stableNames: ReadonlySet<string>): number {
  return [...managed.keys()].filter((name) => stableNames.has(name)).length;
}
