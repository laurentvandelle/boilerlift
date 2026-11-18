import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { describeFailure, isFatal, runEnd } from '#src/core/deliver/deploy-failure';
import { DeployError, DeployPlan, DeployReport, DeployResult, PlannedStep, ResultAction } from '#src/core/deliver/deploy.model';
import { isSameContent } from '#src/core/deliver/normalize';
import { LOCK_FILE } from '#src/core/deliver/lock-file';
import { LockWriter } from '#src/core/deliver/lock-file.model';
import { ApiAnswer, ApiFailure, N8nClient, N8nWorkflowBody, WorkflowId } from '#src/core/n8n/n8n.model';
import { Result, err, ok } from '#src/core/common/result';

type WriteStep = Extract<PlannedStep, { action: 'created' | 'recreated' | 'updated' | 'restored' }>;

/** Why a write failed, and the id of the workflow it created first, when there is one. */
interface WriteFailure {
  error: DeployError;
  id?: WorkflowId;
}

/**
 * Runs the writes of a plan. A plan stopped by a fatal failure writes nothing: the workflows it would have written
 * are reported `not-processed`. Skipped and failed workflows make no call. A created or recreated workflow has its id
 * recorded with `lock` right away; a record that fails stops the run. Each write returns its failure, so a throw from
 * here is a bug.
 */
export async function applyPlan(plan: DeployPlan, client: N8nClient, lock: LockWriter): Promise<DeployReport> {
  if (plan.error !== undefined) {
    const steps = plan.steps.map((step): PlannedStep => (isWrite(step) ? { workflow: step.workflow, action: 'not-processed' } : step));
    return planToReport({ ...plan, steps });
  }
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
    const written = await write(client, lock, step);
    if (written.ok) {
      results.push(written.value);
      continue;
    }
    const { error } = written.error;
    const id = written.error.id ?? ('id' in step ? step.id : undefined);
    results.push(failed(step.workflow, error, id));
    if (isFatal(error)) {
      fatal = error;
    }
  }
  const recorded = results.some(({ action }) => action === 'created' || action === 'recreated');
  return { results, warnings: plan.warnings, lockFile: { path: LOCK_FILE, changed: recorded }, ...runEnd(results, fatal) };
}

/**
 * The report a plan stands for, without the data apply needs. A dry run returns it: the lock file would change when
 * some workflow would be created or recreated.
 */
export function planToReport({ steps, warnings, ...end }: DeployPlan): DeployReport {
  const changed = end.error === undefined && steps.some(({ action }) => action === 'created' || action === 'recreated');
  return { results: steps.map(resultOf), warnings, lockFile: { path: LOCK_FILE, changed }, ...end };
}

function isWrite(step: PlannedStep): step is WriteStep {
  return step.action === 'created' || step.action === 'recreated' || step.action === 'updated' || step.action === 'restored';
}

async function write(client: N8nClient, lock: LockWriter, step: WriteStep): Promise<Result<DeployResult, WriteFailure>> {
  const { workflow } = step;
  switch (step.action) {
  case 'created':
    return create(client, lock, workflow, (id) => ({ action: 'created', id }));
  case 'recreated': {
    const { previousId } = step;
    return create(client, lock, workflow, (id) => ({ action: 'recreated', previousId, id }));
  }
  case 'updated': {
    const updated = failureOf(await client.updateWorkflow(step.id, bodyOf(workflow)));
    return updated === undefined ? ok(result(workflow, { action: 'updated', id: step.id })) : err({ error: updated });
  }
  case 'restored': {
    const restored = await restore(client, workflow, step.id);
    return restored.ok ? restored : err({ error: restored.error });
  }
  }
}

/** Creates the workflow from code, then records its new id in the lock file. */
async function create(
  client: N8nClient,
  lock: LockWriter,
  workflow: LocalWorkflow,
  action: (id: WorkflowId) => ResultAction,
): Promise<Result<DeployResult, WriteFailure>> {
  const created = await client.createWorkflow(bodyOf(workflow));
  if (!created.ok) {
    return err({ error: describeFailure(created.error) });
  }
  const { id } = created.value.body;
  const recorded = await lock.record(workflow.stableName, id);
  return recorded.ok ? ok(result(workflow, action(id))) : err({ error: recorded.error, id });
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
      return err(updated);
    }
  }
  return ok(result(workflow, { action: 'restored', id }));
}

/** The deploy failure of a call that failed, or `undefined` when it went through. */
function failureOf(answer: Result<ApiAnswer<unknown>, ApiFailure>): DeployError | undefined {
  return answer.ok ? undefined : describeFailure(answer.error);
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
