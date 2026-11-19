import { applyPlan, planToReport } from '#src/core/deliver/apply-plan';
import { DeployInput, DeployReport } from '#src/core/deliver/deploy.model';
import { LockWriter } from '#src/core/deliver/lock-file.model';
import { planDeploy } from '#src/core/deliver/plan-deploy';
import { addTargetTag, previewTargetTag } from '#src/core/deliver/target-tag';

/**
 * Delivers the local workflows to the instance: `planDeploy`, then `applyPlan`, then `addTargetTag` when the target
 * keeps its tag. Every read is done before the first write, but the one a restore makes after it unarchives the
 * workflow (ADR 0004). Workflows are found by the ids the lock file records (ADR 0009), never by a tag. New ones, and
 * recorded ones the instance no longer has, are created (never published) and their ids recorded with `lock`; changed
 * ones are updated as drafts (`publishIfActive=false`); unchanged ones are skipped; archived ones are unarchived and
 * updated as drafts. A failure on one workflow fails only that workflow. An unreachable instance, a rejected key or a
 * lock file that cannot be written stops the rest. The target tag is display-only (ADR 0014): a failure to add it is a
 * warning.
 */
export async function deploy(input: DeployInput, lock: LockWriter): Promise<DeployReport> {
  const plan = await planDeploy(input);
  const report = await applyPlan(plan, input.client, lock);
  return input.targetTag === undefined ? report : addTargetTag(report, plan.tags, input.client, input.targetTag);
}

/** What deploy would do, from reads only: the plan as a report, with how many workflows would receive the target tag. */
export async function previewDeploy(input: DeployInput): Promise<DeployReport> {
  const plan = await planDeploy(input);
  const report = planToReport(plan);
  return input.targetTag === undefined ? report : previewTargetTag(report, plan.tags, input.targetTag);
}
