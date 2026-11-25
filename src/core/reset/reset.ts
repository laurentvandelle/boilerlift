import { readStopExitCode, readWorkflowsToRemove } from '#src/core/removal/removal';
import { PlanResetInput, ResetPlan } from '#src/core/reset/reset.model';
import { decideResetScope } from '#src/core/reset/reset.rules';

/**
 * Works out what reset would remove on one target, with GET calls only: one per entry it removes, by the id the lock
 * file records (ADR 0009). The lock file is keyed by instance, not by target (ADR 0018): which entries go and which
 * stay for the other targets on the instance is decided by `decideResetScope` (`reset.rules.ts`). It never writes; the
 * removal is `applyRemoval`.
 */
export async function planReset({ client, managed, others, mode }: PlanResetInput): Promise<ResetPlan> {
  const { removed, kept } = decideResetScope(managed, others);
  const read = await readWorkflowsToRemove(client, removed, mode);
  if (!read.ok) {
    return { kind: 'stopped', error: read.error, exitCode: readStopExitCode(read.error) };
  }
  return { kind: 'ready', workflows: read.value, kept };
}
