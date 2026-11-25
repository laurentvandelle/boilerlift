import { LocalWorkflow, StableName } from '#src/core/compile/workflow.model';
import { Result } from '#src/core/common/result';
import { describeFailure, draftsUnsupported, isFatal, runEnd } from '#src/core/deliver/deploy-failure';
import { DeployError, DeployPlan, DeployWarning, PlannedStep } from '#src/core/deliver/deploy.model';
import { isSameContent } from '#src/core/deliver/normalize';
import { DRAFT_PARAM } from '#src/core/n8n/n8n-api';
import { ApiAnswer, ApiFailure, N8nTag, N8nWorkflow, WorkflowId } from '#src/core/n8n/n8n.model';

/**
 * What the API spec read means for deploy: nothing when the instance supports drafts, or the error that stops the plan
 * before any workflow (ADR 0003). An HTTP error on the spec counts as no draft support; any other failure keeps its own
 * meaning (`describeFailure`).
 */
export function decideSpec(spec: Result<ApiAnswer<string>, ApiFailure>): DeployError | undefined {
  if (!spec.ok) {
    const failure = spec.error;
    return failure.kind === 'http-error' ? draftsUnsupported(failure.call, failure.status) : describeFailure(failure);
  }
  return spec.value.body.includes(DRAFT_PARAM) ? undefined : draftsUnsupported(spec.value.call);
}

/** A plan that stopped on `error` before any workflow. */
export function stoppedPlan(error: DeployError): DeployPlan {
  return { steps: [], warnings: [], tags: new Map(), ...runEnd([], error) };
}

/** Whether a failed draft read stops the plan: the workflows after it are not read. A 404 or another HTTP error does not. */
export function stopsReading(failure: ApiFailure): boolean {
  return isFatal(describeFailure(failure));
}

/** The workflows in the order deploy reads, plans and applies them: by stable name. */
export function byStableName(workflows: LocalWorkflow[]): LocalWorkflow[] {
  return [...workflows].sort((a, b) => a.stableName.localeCompare(b.stableName));
}

/**
 * Decides each workflow's action from the draft reads, in stable-name order. A workflow with no recorded id is
 * `created`; a recorded id that answered 404 is `recreated`; an archived draft is `restored`, with a warning; a draft
 * with the same content is `skipped`, another one `updated`. A failed read fails that workflow; when the failure stops
 * the run, every workflow after it is `not-processed`, as is a recorded workflow with no read.
 */
export function decideSteps(
  workflows: LocalWorkflow[],
  managed: ReadonlyMap<StableName, WorkflowId>,
  drafts: ReadonlyMap<StableName, Result<ApiAnswer<N8nWorkflow>, ApiFailure>>,
): DeployPlan {
  const warnings: DeployWarning[] = [];
  const steps: PlannedStep[] = [];
  const tags = new Map<StableName, N8nTag[]>();
  let fatal: DeployError | undefined;
  for (const workflow of byStableName(workflows)) {
    if (fatal !== undefined) {
      steps.push({ workflow, action: 'not-processed' });
      continue;
    }
    const id = managed.get(workflow.stableName);
    if (id === undefined) {
      steps.push({ workflow, action: 'created' });
      continue;
    }
    const draft = drafts.get(workflow.stableName);
    if (draft === undefined) {
      steps.push({ workflow, action: 'not-processed' });
      continue;
    }
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

function failedStep(workflow: LocalWorkflow, { call, detail, hint }: DeployError, id?: WorkflowId): PlannedStep {
  return { workflow, action: 'failed', ...(id === undefined ? {} : { id }), error: { call, detail, hint } };
}
