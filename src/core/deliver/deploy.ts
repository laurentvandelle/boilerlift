import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_UNREACHABLE } from '#src/core/connection/check-connection';
import { DeployError, DeployInput, DeployReport, DeployResult } from '#src/core/deliver/deploy.model';
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
 * Delivers the local workflows to the instance. Reads first and writes nothing until it knows the instance saves
 * drafts. New ones are created (never published) and tagged `n8nlift:<stable-name>`; changed ones are updated as
 * drafts (`publishIfActive=false`); unchanged ones are skipped; archived ones are unarchived and updated as drafts.
 * A failure on one workflow fails only that workflow. An unreachable instance or a rejected key stops the rest.
 */
export async function deploy({ workflows, client }: DeployInput): Promise<DeployReport> {
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
  const tags = lazyTags(client);
  const warnings: string[] = [];
  const results: DeployResult[] = [];
  let fatal: DeployError | undefined;
  for (const workflow of [...workflows].sort((a, b) => a.stableName.localeCompare(b.stableName))) {
    if (fatal !== undefined) {
      results.push(result(workflow, 'not-processed'));
      continue;
    }
    const target = resolveTarget(workflow.stableName, index.get(workflow.stableName), warnings);
    if (target.kind === 'duplicate') {
      results.push(failed(workflow, duplicateTag(workflow.stableName, target.ids)));
      continue;
    }
    try {
      results.push(await deliver(client, tags, workflow, target));
    } catch (error) {
      if (!(error instanceof Stop)) {
        throw error;
      }
      results.push(failed(workflow, error.deployError, target.kind === 'create' ? undefined : target.id));
      if (error.deployError.exitCode !== EXIT_PARTIAL_FAILURE) {
        fatal = error.deployError;
      }
    }
  }
  const exitCode = fatal?.exitCode ?? (results.some(({ action }) => action === 'failed') ? EXIT_PARTIAL_FAILURE : 0);
  return { results, warnings, ...(fatal === undefined ? {} : { error: fatal }), exitCode };
}

function stopped(error: DeployError): DeployReport {
  return { results: [], warnings: [], error, exitCode: error.exitCode };
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

/** Picks what to do with one workflow, and adds a warning when the instance holds extra tagged copies. */
function resolveTarget(stableName: string, matches: Matches | undefined, warnings: string[]): Target {
  if (matches === undefined) {
    return { kind: 'create' };
  }
  const { live, archived } = matches;
  const tag = stableTag(stableName);
  if (live.length > 1) {
    return { kind: 'duplicate', ids: live };
  }
  const [liveId] = live;
  if (liveId !== undefined) {
    if (archived.length > 0) {
      warnings.push(
        `${stableName}: archived ${plural(archived, 'workflow')} ${list(archived)} still ${archived.length === 1 ? 'carries' : 'carry'} the tag ${tag}; deploy used the live workflow ${liveId}`,
      );
    }
    return { kind: 'update', id: liveId };
  }
  const [archivedId] = archived;
  if (archivedId === undefined) {
    return { kind: 'create' };
  }
  warnings.push(`${stableName}: workflow ${archivedId} was archived in n8n; it is back as an unpublished draft`);
  if (archived.length > 1) {
    warnings.push(`${stableName}: archived workflows ${list(archived)} all carry the tag ${tag}; deploy restored ${archivedId}`);
  }
  return { kind: 'restore', id: archivedId };
}

async function deliver(
  client: N8nClient,
  tags: (name: string) => Promise<N8nTag>,
  workflow: LocalWorkflow,
  target: Exclude<Target, { kind: 'duplicate' }>,
): Promise<DeployResult> {
  switch (target.kind) {
  case 'create':
    return create(client, tags, workflow);
  case 'update':
    return update(client, workflow, target.id);
  case 'restore':
    return restore(client, workflow, target.id);
  }
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

async function update(client: N8nClient, workflow: LocalWorkflow, id: string): Promise<DeployResult> {
  const remote = unwrap(await client.getWorkflow(id));
  if (isSameContent(workflow, remote)) {
    return result(workflow, 'skipped', id);
  }
  unwrap(await client.updateWorkflow(id, bodyOf(workflow)));
  return result(workflow, 'updated', id);
}

/** Unarchives the workflow, then updates it like any other. It reports `restored` even when the content matched. */
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
  await update(client, workflow, id);
  return result(workflow, 'restored', id);
}

/** Finds a tag by name, creating it on first use. The tag list is read once. */
function lazyTags(client: N8nClient): (name: string) => Promise<N8nTag> {
  let cache: N8nTag[] | undefined;
  return async (name) => {
    cache ??= unwrap(await client.listTags());
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
