import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { Result } from '#src/core/common/result';
import { describeFailure } from '#src/core/deliver/deploy-failure';
import { DeployInput, DeployPlan } from '#src/core/deliver/deploy.model';
import { byStableName, decideSpec, decideSteps, stoppedPlan, stopsReading } from '#src/core/deliver/plan-deploy.rules';
import { resolveCredentials } from '#src/core/deliver/resolve-credentials';
import { ApiAnswer, ApiFailure, N8nClient, N8nWorkflow, WorkflowId } from '#src/core/n8n/n8n.model';

/**
 * Computes what deploy would do, with reads only: the API spec, then the credentials of the instance when workflows
 * use `credential()` (`resolveCredentials`), then one GET per workflow the lock file records (ADR 0009). A missing
 * credential stops the plan before any workflow. A workflow on the instance that the lock file does not record is never
 * read. It never writes. The actions are decided by `decideSteps` (`plan-deploy.rules.ts`).
 */
export async function planDeploy(input: DeployInput): Promise<DeployPlan> {
  const { client, managed } = input;
  const unsupported = decideSpec(await client.readApiSpec());
  if (unsupported !== undefined) {
    return stoppedPlan(unsupported);
  }
  const resolved = await resolveCredentials({ ...input, command: 'deploy' });
  if (!resolved.ok) {
    const { error } = resolved;
    return stoppedPlan(error.kind === 'list-failed' ? describeFailure(error.failure) : error);
  }
  const drafts = await readDrafts(resolved.value, managed, client);
  return decideSteps(resolved.value, managed, drafts);
}

/** One GET per recorded workflow, in stable-name order, until a read fails in a way that stops the run. */
async function readDrafts(
  workflows: LocalWorkflow[],
  managed: ReadonlyMap<StableName, WorkflowId>,
  client: N8nClient,
): Promise<Map<StableName, Result<ApiAnswer<N8nWorkflow>, ApiFailure>>> {
  const drafts = new Map<StableName, Result<ApiAnswer<N8nWorkflow>, ApiFailure>>();
  for (const workflow of byStableName(workflows)) {
    const id = managed.get(workflow.stableName);
    if (id === undefined) {
      continue;
    }
    const draft = await client.getWorkflow(id);
    drafts.set(workflow.stableName, draft);
    if (!draft.ok && stopsReading(draft.error)) {
      break;
    }
  }
  return drafts;
}
