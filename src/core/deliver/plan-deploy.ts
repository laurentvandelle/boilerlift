import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { describeFailure, draftsUnsupported, isFatal, runEnd } from '#src/core/deliver/deploy-failure';
import { DeployError, DeployInput, DeployPlan, DeployWarning, PlannedStep } from '#src/core/deliver/deploy.model';
import { isSameContent } from '#src/core/deliver/normalize';
import { DRAFT_PARAM } from '#src/core/n8n/n8n-api';
import { N8nTag, WorkflowId } from '#src/core/n8n/n8n.model';

/**
 * Computes what deploy would do, with reads only: the API spec, then one GET per workflow the lock file records
 * (ADR 0009). A workflow with no recorded id is created; a recorded id that answers 404 is recreated. A workflow on
 * the instance that the lock file does not record is never read. It never writes.
 */
export async function planDeploy({ workflows, client, managed }: DeployInput): Promise<DeployPlan> {
  const spec = await client.readApiSpec();
  if (!spec.ok) {
    const failure = spec.error;
    return stopped(failure.kind === 'http-error' ? draftsUnsupported(failure.call, failure.status) : describeFailure(failure));
  }
  if (!spec.value.body.includes(DRAFT_PARAM)) {
    return stopped(draftsUnsupported(spec.value.call));
  }

  const warnings: DeployWarning[] = [];
  const steps: PlannedStep[] = [];
  const tags = new Map<StableName, N8nTag[]>();
  let fatal: DeployError | undefined;
  for (const workflow of sortByStableName(workflows)) {
    if (fatal !== undefined) {
      steps.push({ workflow, action: 'not-processed' });
      continue;
    }
    const id = managed.get(workflow.stableName);
    if (id === undefined) {
      steps.push({ workflow, action: 'created' });
      continue;
    }
    const draft = await client.getWorkflow(id);
    if (draft.ok) {
      tags.set(workflow.stableName, draft.value.body.tags);
      if (draft.value.body.isArchived) {
        warnings.push({ kind: 'restored', stableName: workflow.stableName, id });
        steps.push({ workflow, action: 'restored', id });
      } else {
        steps.push({ workflow, action: isSameContent(workflow, draft.value.body) ? 'skipped' : 'updated', id });
      }
      continue;
    }
    if (draft.error.kind === 'http-error' && draft.error.status === 404) {
      steps.push({ workflow, action: 'recreated', previousId: id });
      continue;
    }
    const error = describeFailure(draft.error);
    steps.push(failedStep(workflow, error, id));
    if (isFatal(error)) {
      fatal = error;
    }
  }
  return { steps, warnings, tags, ...runEnd(steps, fatal) };
}

function stopped(error: DeployError): DeployPlan {
  return { steps: [], warnings: [], tags: new Map(), ...runEnd([], error) };
}

function sortByStableName(workflows: LocalWorkflow[]): LocalWorkflow[] {
  return [...workflows].sort((a, b) => a.stableName.localeCompare(b.stableName));
}

function failedStep(workflow: LocalWorkflow, { call, detail, hint }: DeployError, id?: WorkflowId): PlannedStep {
  return { workflow, action: 'failed', ...(id === undefined ? {} : { id }), error: { call, detail, hint } };
}
