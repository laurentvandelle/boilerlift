import { applyPlan } from '#src/core/deliver/apply-plan';
import { DeployInput, DeployReport } from '#src/core/deliver/deploy.model';
import { LockWriter } from '#src/core/deliver/lock-file.model';
import { planDeploy } from '#src/core/deliver/plan-deploy';

/**
 * Delivers the local workflows to the instance: `planDeploy`, then `applyPlan`. Every read is done before the first
 * write, but the one a restore makes after it unarchives the workflow (ADR 0004). Workflows are found by the ids the
 * lock file records (ADR 0009). New ones, and recorded ones the instance no longer has, are created (never published)
 * and their ids recorded with `lock`; changed ones are updated as drafts (`publishIfActive=false`); unchanged ones are
 * skipped; archived ones are unarchived and updated as drafts. A failure on one workflow fails only that workflow. An
 * unreachable instance, a rejected key or a lock file that cannot be written stops the rest.
 */
export async function deploy(input: DeployInput, lock: LockWriter): Promise<DeployReport> {
  return applyPlan(await planDeploy(input), input.client, lock);
}
