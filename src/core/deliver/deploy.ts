import { applyPlan } from '#src/core/deliver/apply-plan';
import { DeployInput, DeployReport } from '#src/core/deliver/deploy.model';
import { planDeploy } from '#src/core/deliver/plan-deploy';

/**
 * Delivers the local workflows to the instance: `planDeploy`, then `applyPlan`. Every read is done before the first
 * write, but the one a restore makes after it unarchives the workflow (ADR 0004). New ones are created (never published) and tagged `n8nlift:<stable-name>`; changed ones are updated as
 * drafts (`publishIfActive=false`); unchanged ones are skipped; archived ones are unarchived and updated as drafts.
 * A failure on one workflow fails only that workflow. An unreachable instance or a rejected key stops the rest.
 */
export async function deploy(input: DeployInput): Promise<DeployReport> {
  return applyPlan(await planDeploy(input), input.client);
}
