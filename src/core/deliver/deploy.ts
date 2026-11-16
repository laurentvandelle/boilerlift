import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_UNREACHABLE } from '#src/core/connection/check-connection';
import {
  DeployError,
  DeployInput,
  DeployPlan,
  DeployReport,
  DeployResult,
  PlanMode,
  PlannedStep,
} from '#src/core/deliver/deploy.model';
import { isSameContent } from '#src/core/deliver/normalize';
import { SPEC_PATH } from '#src/core/n8n/n8n-client';
import { ApiFailure, ApiResult, N8nClient, N8nTag, N8nWorkflowBody, N8nWorkflowSummary } from '#src/core/n8n/n8n.model';

export const STABLE_TAG_PREFIX = 'n8nlift:';

/** Exit code when at least one workflow failed and nothing stopped the whole run. */
export const EXIT_PARTIAL_FAILURE = 5;
/** Exit code when the instance cannot save drafts (older than n8n 2.35.0). */
export const EXIT_DRAFTS_UNSUPPORTED = 6;

/** The query parameter that makes an update land as a draft. Its presence in the spec means drafts are supported. */
const DRAFT_PARAM = 'publishIfActive';
const LIST_CALL = 'GET /api/v1/workflows';

/** The tag that identifies a workflow on the instance. */
export function stableTag(stableName: string): string {
  return `${STABLE_TAG_PREFIX}${stableName}`;
}

/** The instance workflows that carry one stable tag. */
interface Matches {
  live: string[];
  archived: string[];
}

type Target =
  | { kind: 'create' }
  | { kind: 'update'; id: string }
  | { kind: 'restore'; id: string }
  | { kind: 'duplicate'; ids: string[] };

class Stop extends Error {
  constructor(readonly deployError: DeployError) {
    super(deployError.detail);
  }
}

/**
 * Delivers the local workflows to the instance: `planDeploy`, then `applyPlan`. Every read is done before the first
 * write. New ones are created (never published) and tagged `n8nlift:<stable-name>`; changed ones are updated as
 * drafts (`publishIfActive=false`); unchanged ones are skipped; archived ones are unarchived and updated as drafts.
 * A failure on one workflow fails only that workflow. An unreachable instance or a rejected key stops the rest.
 */
export async function deploy(input: DeployInput): Promise<DeployReport> {
  return applyPlan(await planDeploy(input, 'deploy'), input.client);
}

/**
 * Computes what deploy would do, with reads only: the workflow list, the API spec, one GET per workflow to update,
 * and the tag list when a workflow would be created. It never writes. `mode` only changes how warnings are worded.
 */
export async function planDeploy({ workflows, client }: DeployInput, mode: PlanMode = 'dry-run'): Promise<DeployPlan> {
  const listed = await client.listWorkflows();
  if (listed.kind !== 'ok') {
    return stopped(describeFailure(listed));
  }
  const spec = await client.readApiSpec();
  if (spec.kind === 'unreachable') {
    return stopped(describeFailure(spec));
  }
  if (spec.kind === 'http-error' || !spec.body.includes(DRAFT_PARAM)) {
    return stopped(draftsUnsupported(spec));
  }

  const index = indexByStableTag(listed.body);
  const warnings: string[] = [];
  const steps: PlannedStep[] = [];
  let fatal: DeployError | undefined;
  for (const workflow of sortByStableName(workflows)) {
    if (fatal !== undefined) {
      steps.push({ workflow, action: 'not-processed' });
      continue;
    }
    const target = resolveTarget(workflow.stableName, index.get(workflow.stableName), warnings, mode);
    switch (target.kind) {
    case 'duplicate':
      steps.push(failedStep(workflow, duplicateTag(workflow.stableName, target.ids)));
      break;
    case 'create':
      steps.push({ workflow, action: 'created' });
      break;
    case 'restore':
      steps.push({ workflow, action: 'restored', id: target.id });
      break;
    case 'update': {
      const remote = await client.getWorkflow(target.id);
      if (remote.kind === 'ok') {
        steps.push({ workflow, action: isSameContent(workflow, remote.body) ? 'skipped' : 'updated', id: target.id });
        break;
      }
      const error = describeFailure(remote);
      steps.push(failedStep(workflow, error, target.id));
      if (isFatal(error)) {
        fatal = error;
      }
    }
    }
  }

  let tags: N8nTag[] | undefined;
  if (fatal === undefined && steps.some(({ action }) => action === 'created')) {
    const listedTags = await client.listTags();
    if (listedTags.kind === 'ok') {
      tags = listedTags.body;
    } else {
      const error = describeFailure(listedTags);
      for (const [i, step] of steps.entries()) {
        if (step.action === 'created') {
          steps[i] = failedStep(step.workflow, error);
        }
      }
      if (isFatal(error)) {
        fatal = error;
      }
    }
  }
  return {
    steps,
    warnings,
    ...(tags === undefined ? {} : { tags }),
    ...(fatal === undefined ? {} : { error: fatal }),
    exitCode: exitCodeOf(steps, fatal),
  };
}

/**
 * Runs the writes of a plan. A plan stopped by a fatal failure writes nothing: the workflows it would have written
 * are reported `not-processed`. Skipped and failed workflows make no call.
 */
export async function applyPlan(plan: DeployPlan, client: N8nClient): Promise<DeployReport> {
  if (plan.error !== undefined) {
    const steps = plan.steps.map((step): PlannedStep => (writes(step) ? { workflow: step.workflow, action: 'not-processed' } : step));
    return planToReport({ ...plan, steps });
  }
  const tags = tagFinder(client, plan.tags ?? []);
  const results: DeployResult[] = [];
  let fatal: DeployError | undefined;
  for (const step of plan.steps) {
    if (fatal !== undefined) {
      results.push(result(step.workflow, 'not-processed'));
      continue;
    }
    if (!writes(step)) {
      results.push(resultOf(step));
      continue;
    }
    try {
      results.push(await write(client, tags, step));
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

function stopped(error: DeployError): DeployPlan {
  return { steps: [], warnings: [], error, exitCode: error.exitCode };
}

function sortByStableName(workflows: LocalWorkflow[]): LocalWorkflow[] {
  return [...workflows].sort((a, b) => a.stableName.localeCompare(b.stableName));
}

/** A failure that stops the whole run: anything but a per-workflow failure (exit 5). */
function isFatal(error: DeployError): boolean {
  return error.exitCode !== EXIT_PARTIAL_FAILURE;
}

function exitCodeOf(items: { action: DeployResult['action'] }[], fatal: DeployError | undefined): number {
  return fatal?.exitCode ?? (items.some(({ action }) => action === 'failed') ? EXIT_PARTIAL_FAILURE : 0);
}

function writes(step: PlannedStep): step is PlannedStep & { action: 'created' | 'updated' | 'restored' } {
  return step.action === 'created' || step.action === 'updated' || step.action === 'restored';
}

function draftsUnsupported(spec: Exclude<ApiResult<string>, { kind: 'unreachable' }>): DeployError {
  const reason = spec.kind === 'http-error' ? `HTTP ${spec.status}` : `the API spec has no ${DRAFT_PARAM}`;
  return {
    call: `GET ${SPEC_PATH}`,
    detail: `${reason}: n8n 2.35.0 or later is required`,
    hint: 'Upgrade the instance to n8n 2.35.0 or later, then run deploy again',
    exitCode: EXIT_DRAFTS_UNSUPPORTED,
  };
}

function indexByStableTag(remote: N8nWorkflowSummary[]): Map<string, Matches> {
  const index = new Map<string, Matches>();
  for (const workflow of remote) {
    for (const tag of workflow.tags) {
      if (!tag.name.startsWith(STABLE_TAG_PREFIX)) {
        continue;
      }
      const stableName = tag.name.slice(STABLE_TAG_PREFIX.length);
      const matches = index.get(stableName) ?? { live: [], archived: [] };
      (workflow.isArchived ? matches.archived : matches.live).push(workflow.id);
      index.set(stableName, matches);
    }
  }
  return index;
}

/**
 * Picks what to do with one workflow, and adds a warning when the instance holds extra tagged copies. A dry run
 * words the warnings as what deploy would do.
 */
function resolveTarget(stableName: string, matches: Matches | undefined, warnings: string[], mode: PlanMode): Target {
  if (matches === undefined) {
    return { kind: 'create' };
  }
  const dryRun = mode === 'dry-run';
  const { live, archived } = matches;
  const tag = stableTag(stableName);
  if (live.length > 1) {
    return { kind: 'duplicate', ids: live };
  }
  const [liveId] = live;
  if (liveId !== undefined) {
    if (archived.length > 0) {
      warnings.push(
        `${stableName}: archived ${plural(archived, 'workflow')} ${list(archived)} still ${archived.length === 1 ? 'carries' : 'carry'} the tag ${tag}; deploy ${dryRun ? 'would use' : 'used'} the live workflow ${liveId}`,
      );
    }
    return { kind: 'update', id: liveId };
  }
  const [archivedId] = archived;
  if (archivedId === undefined) {
    return { kind: 'create' };
  }
  warnings.push(
    dryRun
      ? `${stableName}: workflow ${archivedId} was archived in n8n; deploy would bring it back as an unpublished draft`
      : `${stableName}: workflow ${archivedId} was archived in n8n; it is back as an unpublished draft`,
  );
  if (archived.length > 1) {
    warnings.push(
      `${stableName}: archived workflows ${list(archived)} all carry the tag ${tag}; deploy ${dryRun ? 'would restore' : 'restored'} ${archivedId}`,
    );
  }
  return { kind: 'restore', id: archivedId };
}

async function write(
  client: N8nClient,
  tags: (name: string) => Promise<N8nTag>,
  step: PlannedStep & { action: 'created' | 'updated' | 'restored' },
): Promise<DeployResult> {
  const { workflow, id } = step;
  if (step.action === 'created' || id === undefined) {
    return create(client, tags, workflow);
  }
  if (step.action === 'updated') {
    unwrap(await client.updateWorkflow(id, bodyOf(workflow)));
    return result(workflow, 'updated', id);
  }
  return restore(client, workflow, id);
}

async function create(
  client: N8nClient,
  tags: (name: string) => Promise<N8nTag>,
  workflow: LocalWorkflow,
): Promise<DeployResult> {
  const created = unwrap(await client.createWorkflow(bodyOf(workflow)));
  const tag = await tags(stableTag(workflow.stableName));
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
  const remote = unwrap(await client.getWorkflow(id));
  if (!isSameContent(workflow, remote)) {
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

function failedStep(workflow: LocalWorkflow, { call, detail, hint }: DeployError, id?: string): PlannedStep {
  return { workflow, action: 'failed', ...(id === undefined ? {} : { id }), error: { call, detail, hint } };
}

function resultOf({ workflow, action, id, error }: PlannedStep): DeployResult {
  return { ...result(workflow, action, id), ...(error === undefined ? {} : { error }) };
}

function duplicateTag(stableName: string, ids: string[]): DeployError {
  const tag = stableTag(stableName);
  return {
    call: LIST_CALL,
    detail: `workflows ${list(ids)} both carry the tag ${tag}`,
    hint: `Remove the tag ${tag} from one of them in the n8n editor, then run deploy again`,
    exitCode: EXIT_PARTIAL_FAILURE,
  };
}

function list(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

function plural(items: unknown[], word: string): string {
  return items.length === 1 ? word : `${word}s`;
}

function unwrap<T>(result: ApiResult<T>): T {
  if (result.kind === 'ok') {
    return result.body;
  }
  throw new Stop(describeFailure(result));
}

/** Classifies a failed call. Exit 3 or 4 stops the whole run; exit 5 fails only the current workflow. */
function describeFailure(failure: ApiFailure): DeployError {
  if (failure.kind === 'unreachable') {
    return {
      call: failure.call,
      detail: `unreachable: ${failure.reason}`,
      hint: 'Run n8nlift ping to check N8N_URL and your network, then run deploy again',
      exitCode: EXIT_UNREACHABLE,
    };
  }
  const detail = `HTTP ${failure.status}${failure.message === undefined ? '' : `: ${failure.message}`}`;
  if (failure.status === 401 || failure.status === 403) {
    return {
      call: failure.call,
      detail,
      hint: 'Create a key in n8n → Settings → n8n API, then set N8N_API_KEY in .env',
      exitCode: EXIT_API_KEY_REJECTED,
    };
  }
  return {
    call: failure.call,
    detail,
    hint: 'Check the workflow file and the n8n instance (n8n 2.35.0 or later), then run deploy again',
    exitCode: EXIT_PARTIAL_FAILURE,
  };
}
