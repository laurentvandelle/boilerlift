import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { describeFailure, isFatal, runEnd } from '#src/core/deliver/deploy-failure';
import { DeployError, DeployPlan, DeployReport, DeployResult, PlannedStep, ResultAction } from '#src/core/deliver/deploy.model';
import { isSameContent } from '#src/core/deliver/normalize';
import { StableTag, stableTag } from '#src/core/deliver/stable-tag';
import { ApiResult, N8nClient, N8nTag, N8nWorkflowBody, WorkflowId } from '#src/core/n8n/n8n.model';
import { Result, err, ok } from '#src/core/common/result';

type WriteStep = Extract<PlannedStep, { action: 'created' | 'updated' | 'restored' }>;

/** Finds the tag of a stable name, creating it on first use. */
type TagFinder = (name: StableTag) => Promise<Result<N8nTag, DeployError>>;

/**
 * Runs the writes of a plan. A plan stopped by a fatal failure writes nothing: the workflows it would have written
 * are reported `not-processed`. Skipped and failed workflows make no call. Each write returns its failure, so a
 * throw from here is a bug.
 */
export async function applyPlan(plan: DeployPlan, client: N8nClient): Promise<DeployReport> {
  if (plan.error !== undefined) {
    const steps = plan.steps.map((step): PlannedStep => (isWrite(step) ? { workflow: step.workflow, action: 'not-processed' } : step));
    return planToReport({ ...plan, steps });
  }
  const ensureTag = tagFinder(client, plan.tags ?? []);
  const results: DeployResult[] = [];
  let fatal: DeployError | undefined;
  for (const step of plan.steps) {
    if (fatal !== undefined) {
      results.push(result(step.workflow, { action: 'not-processed' }));
      continue;
    }
    if (!isWrite(step)) {
      results.push(resultOf(step));
      continue;
    }
    const written = await write(client, ensureTag, step);
    if (written.ok) {
      results.push(written.value);
      continue;
    }
    results.push(failed(step.workflow, written.error, 'id' in step ? step.id : undefined));
    if (isFatal(written.error)) {
      fatal = written.error;
    }
  }
  return { results, warnings: plan.warnings, ...runEnd(results, fatal) };
}

/** The report a plan stands for, without the data apply needs. A dry run returns it. */
export function planToReport({ steps, warnings, tags: _tags, ...end }: DeployPlan): DeployReport {
  return { results: steps.map(resultOf), warnings, ...end };
}

function isWrite(step: PlannedStep): step is WriteStep {
  return step.action === 'created' || step.action === 'updated' || step.action === 'restored';
}

async function write(client: N8nClient, ensureTag: TagFinder, step: WriteStep): Promise<Result<DeployResult, DeployError>> {
  const { workflow } = step;
  switch (step.action) {
  case 'created':
    return create(client, ensureTag, workflow);
  case 'updated': {
    const updated = failureOf(await client.updateWorkflow(step.id, bodyOf(workflow)));
    return updated ?? ok(result(workflow, { action: 'updated', id: step.id }));
  }
  case 'restored':
    return restore(client, workflow, step.id);
  }
}

async function create(client: N8nClient, ensureTag: TagFinder, workflow: LocalWorkflow): Promise<Result<DeployResult, DeployError>> {
  const created = await client.createWorkflow(bodyOf(workflow));
  if (!created.ok) {
    return err(describeFailure(created.error));
  }
  const { id, tags } = created.value.body;
  const tag = await ensureTag(stableTag(workflow.stableName));
  if (!tag.ok) {
    return tag;
  }
  const existing = tags.map((candidate) => candidate.id).filter((tagId) => tagId !== tag.value.id);
  const tagged = failureOf(await client.setWorkflowTags(id, [...existing, tag.value.id]));
  return tagged ?? ok(result(workflow, { action: 'created', id }));
}

/**
 * Unarchives the workflow, then reads it and updates it when it differs. That read follows a write by nature. It
 * reports `restored` even when the content matched.
 */
async function restore(client: N8nClient, workflow: LocalWorkflow, id: WorkflowId): Promise<Result<DeployResult, DeployError>> {
  const unarchived = await client.unarchiveWorkflow(id);
  if (!unarchived.ok) {
    const error = describeFailure(unarchived.error);
    if (unarchived.error.kind !== 'http-error') {
      return err(error);
    }
    return err({
      ...error,
      kind: 'workflow-failed',
      hint: 'Unarchive the workflow in the n8n editor, or give the API key the workflow:delete scope, then run deploy again',
    });
  }
  const draft = await client.getWorkflow(id);
  if (!draft.ok) {
    return err(describeFailure(draft.error));
  }
  if (!isSameContent(workflow, draft.value.body)) {
    const updated = failureOf(await client.updateWorkflow(id, bodyOf(workflow)));
    if (updated !== undefined) {
      return updated;
    }
  }
  return ok(result(workflow, { action: 'restored', id }));
}

/** Finds a tag by name in the planned tag list, creating it on first use. */
function tagFinder(client: N8nClient, planned: N8nTag[]): TagFinder {
  const cache = [...planned];
  return async (name) => {
    const found = cache.find((tag) => tag.name === name);
    if (found !== undefined) {
      return ok(found);
    }
    const created = await client.createTag(name);
    if (!created.ok) {
      return err(describeFailure(created.error));
    }
    cache.push(created.value.body);
    return ok(created.value.body);
  };
}

/** The deploy failure of a call that failed, or `undefined` when it went through. */
function failureOf(answer: ApiResult<unknown>): Result<never, DeployError> | undefined {
  return answer.ok ? undefined : err(describeFailure(answer.error));
}

function bodyOf({ name, nodes, connections, settings }: LocalWorkflow): N8nWorkflowBody {
  return { name, nodes, connections, settings };
}

function result(workflow: LocalWorkflow, action: ResultAction): DeployResult {
  return { stableName: workflow.stableName, path: workflow.path, ...action, name: workflow.name };
}

function failed(workflow: LocalWorkflow, { call, detail, hint }: DeployError, id?: WorkflowId): DeployResult {
  return result(workflow, { action: 'failed', ...(id === undefined ? {} : { id }), error: { call, detail, hint } });
}

function resultOf({ workflow, ...action }: PlannedStep): DeployResult {
  return result(workflow, action);
}
