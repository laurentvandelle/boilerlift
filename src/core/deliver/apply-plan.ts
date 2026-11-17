import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { Stop, describeFailure, exitCodeOf, isFatal, unwrap } from '#src/core/deliver/deploy-failure';
import { DeployError, DeployPlan, DeployReport, DeployResult, PlannedStep } from '#src/core/deliver/deploy.model';
import { isSameContent } from '#src/core/deliver/normalize';
import { stableTag } from '#src/core/deliver/stable-tag';
import { EXIT_PARTIAL_FAILURE } from '#src/core/exit/exit-codes';
import { N8nClient, N8nTag, N8nWorkflowBody } from '#src/core/n8n/n8n.model';

/**
 * Runs the writes of a plan. A plan stopped by a fatal failure writes nothing: the workflows it would have written
 * are reported `not-processed`. Skipped and failed workflows make no call.
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
      results.push(result(step.workflow, 'not-processed'));
      continue;
    }
    if (!isWrite(step)) {
      results.push(resultOf(step));
      continue;
    }
    try {
      results.push(await write(client, ensureTag, step));
    } catch (error) {
      if (!(error instanceof Stop)) {
        throw error;
      }
      results.push(failed(step.workflow, error.deployError, step.id));
      if (isFatal(error.deployError)) {
        fatal = error.deployError;
      }
    }
  }
  return {
    results,
    warnings: plan.warnings,
    ...(fatal === undefined ? {} : { error: fatal }),
    exitCode: exitCodeOf(results, fatal),
  };
}

/** The report a plan stands for, without the data apply needs. A dry run returns it. */
export function planToReport(plan: DeployPlan): DeployReport {
  return {
    results: plan.steps.map(resultOf),
    warnings: plan.warnings,
    ...(plan.error === undefined ? {} : { error: plan.error }),
    exitCode: plan.exitCode,
  };
}

function isWrite(step: PlannedStep): step is PlannedStep & { action: 'created' | 'updated' | 'restored' } {
  return step.action === 'created' || step.action === 'updated' || step.action === 'restored';
}

async function write(
  client: N8nClient,
  ensureTag: (name: string) => Promise<N8nTag>,
  step: PlannedStep & { action: 'created' | 'updated' | 'restored' },
): Promise<DeployResult> {
  const { workflow, id } = step;
  if (step.action === 'created' || id === undefined) {
    return create(client, ensureTag, workflow);
  }
  if (step.action === 'updated') {
    unwrap(await client.updateWorkflow(id, bodyOf(workflow)));
    return result(workflow, 'updated', id);
  }
  return restore(client, workflow, id);
}

async function create(
  client: N8nClient,
  ensureTag: (name: string) => Promise<N8nTag>,
  workflow: LocalWorkflow,
): Promise<DeployResult> {
  const created = unwrap(await client.createWorkflow(bodyOf(workflow)));
  const tag = await ensureTag(stableTag(workflow.stableName));
  const existing = (created.tags ?? []).map(({ id }) => id).filter((id) => id !== tag.id);
  unwrap(await client.setWorkflowTags(created.id, [...existing, tag.id]));
  return result(workflow, 'created', created.id);
}

/**
 * Unarchives the workflow, then reads it and updates it when it differs. That read follows a write by nature. It
 * reports `restored` even when the content matched.
 */
async function restore(client: N8nClient, workflow: LocalWorkflow, id: string): Promise<DeployResult> {
  const unarchived = await client.unarchiveWorkflow(id);
  if (unarchived.kind === 'http-error') {
    throw new Stop({
      ...describeFailure(unarchived),
      hint: 'Unarchive the workflow in the n8n editor, or give the API key the workflow:delete scope, then run deploy again',
      exitCode: EXIT_PARTIAL_FAILURE,
    });
  }
  unwrap(unarchived);
  const draft = unwrap(await client.getWorkflow(id));
  if (!isSameContent(workflow, draft)) {
    unwrap(await client.updateWorkflow(id, bodyOf(workflow)));
  }
  return result(workflow, 'restored', id);
}

/** Finds a tag by name in the planned tag list, creating it on first use. */
function tagFinder(client: N8nClient, planned: N8nTag[]): (name: string) => Promise<N8nTag> {
  const cache = [...planned];
  return async (name) => {
    const found = cache.find((tag) => tag.name === name);
    if (found !== undefined) {
      return found;
    }
    const created = unwrap(await client.createTag(name));
    cache.push(created);
    return created;
  };
}

function bodyOf({ name, nodes, connections, settings }: LocalWorkflow): N8nWorkflowBody {
  return { name, nodes, connections, settings };
}

function result(workflow: LocalWorkflow, action: DeployResult['action'], id?: string): DeployResult {
  return {
    stableName: workflow.stableName,
    path: workflow.path,
    action,
    ...(id === undefined ? {} : { id }),
    name: workflow.name,
  };
}

function failed(workflow: LocalWorkflow, { call, detail, hint }: DeployError, id?: string): DeployResult {
  return { ...result(workflow, 'failed', id), error: { call, detail, hint } };
}

function resultOf({ workflow, action, id, error }: PlannedStep): DeployResult {
  return { ...result(workflow, action, id), ...(error === undefined ? {} : { error }) };
}
