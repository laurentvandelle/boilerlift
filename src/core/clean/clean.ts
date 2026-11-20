import {
  CleanFailure,
  CleanPlan,
  CleanReadError,
  CleanReport,
  CleanResult,
  NotDeployedWorkflow,
  PlanCleanInput,
  RemovedWorkflow,
  UnmanagedWorkflow,
} from '#src/core/clean/clean.model';
import { baseNameOf, isStableName } from '#src/core/compile/load-workflows';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_PARTIAL_FAILURE, EXIT_UNREACHABLE } from '#src/core/common/exit-codes';
import { LOCK_FILE } from '#src/core/deliver/lock-file';
import { LockRemover } from '#src/core/deliver/lock-file.model';
import { MIN_N8N_VERSION, classifyHttpError } from '#src/core/n8n/n8n-api';
import { ApiFailure, N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';

/**
 * Works out what clean would do on one target, with GET calls only: one per removed workflow, by the id the lock file
 * records (ADR 0009), then every page of the workflow list for the ones it does not record. It never writes. The first
 * failed call stops the plan.
 */
export async function planClean({ client, managed, removed, files }: PlanCleanInput): Promise<CleanPlan> {
  const found: RemovedWorkflow[] = [];
  for (const [stableName, id] of [...removed].sort(([a], [b]) => a.localeCompare(b))) {
    const read = await client.getWorkflow(id);
    if (read.ok) {
      const { name, isArchived } = read.value.body;
      found.push({ stableName, id, name, state: isArchived ? 'already-archived' : 'to-archive' });
    } else if (read.error.kind === 'http-error' && classifyHttpError(read.error.status) === 'not-found') {
      found.push({ stableName, id, state: 'not-found' });
    } else {
      return stopped(describeReadFailure(read.error));
    }
  }
  const listed = await client.listWorkflows();
  if (!listed.ok) {
    return stopped(describeReadFailure(listed.error));
  }
  const recorded = new Set<WorkflowId>(managed.values());
  const unmanaged = listed.value.body
    .filter(({ id, isArchived }) => !recorded.has(id) && !isArchived)
    .map(({ id, name }): UnmanagedWorkflow => ({ id, name }));
  const notDeployed = [...files]
    .flatMap((path): NotDeployedWorkflow[] => {
      const stableName = baseNameOf(path);
      return isStableName(stableName) && !managed.has(stableName) ? [{ stableName, path }] : [];
    })
    .sort((a, b) => a.stableName.localeCompare(b.stableName));
  return { kind: 'ready', removed: found, notDeployed, unmanaged };
}

/**
 * Archives each removed workflow of the plan that is still on the instance, in order, and drops the lock entry of each
 * one archived, already archived or not found, through `remover`. A failure fails only that workflow and keeps its
 * entry; the others are still cleaned, and the run exits 5.
 */
export async function applyClean(removed: RemovedWorkflow[], client: N8nClient, instance: string, remover: LockRemover): Promise<CleanReport> {
  const results: CleanResult[] = [];
  for (const workflow of removed) {
    results.push(await cleanOne(workflow, client, instance, remover));
  }
  return { results, exitCode: results.some(({ action }) => action === 'failed') ? EXIT_PARTIAL_FAILURE : EXIT_OK };
}

async function cleanOne(workflow: RemovedWorkflow, client: N8nClient, instance: string, remover: LockRemover): Promise<CleanResult> {
  const { stableName, id } = workflow;
  const name = workflow.state === 'not-found' ? null : workflow.name;
  let action: 'archived' | 'already-archived' | 'not-found' = workflow.state === 'to-archive' ? 'archived' : workflow.state;
  if (workflow.state === 'to-archive') {
    const archived = await client.archiveWorkflow(id);
    if (!archived.ok) {
      if (archived.error.kind === 'http-error' && classifyHttpError(archived.error.status) === 'not-found') {
        action = 'not-found';
      } else {
        return { stableName, id, name, action: 'failed', error: describeArchiveFailure(archived.error) };
      }
    }
  }
  const dropped = await remover.remove(instance, stableName);
  if (!dropped.ok) {
    const done = action === 'archived' ? 'was archived' : action === 'already-archived' ? 'is already archived' : 'is not on n8n';
    return {
      stableName,
      id,
      name,
      action: 'failed',
      error: {
        kind: 'lock-write-failed',
        call: `write ${LOCK_FILE}`,
        detail: `workflow ${id} ${done}, but ${LOCK_FILE} could not be written: ${dropped.error.reason}`,
      },
    };
  }
  return { stableName, id, name, action };
}

function stopped(error: CleanReadError): CleanPlan {
  return { kind: 'stopped', error, exitCode: error.kind === 'key-rejected' ? EXIT_API_KEY_REJECTED : EXIT_UNREACHABLE };
}

function httpDetail(failure: { status: number; message?: string }): string {
  return `HTTP ${failure.status}${failure.message === undefined ? '' : `: ${failure.message}`}`;
}

function describeReadFailure(failure: ApiFailure): CleanReadError {
  switch (failure.kind) {
  case 'unreachable':
    return { kind: 'unreachable', call: failure.call, detail: `unreachable: ${failure.reason}` };
  case 'invalid-response':
    return {
      kind: 'unreachable',
      call: failure.call,
      detail: `unexpected answer (HTTP ${failure.status}): ${failure.detail}, check that the url points to n8n ${MIN_N8N_VERSION} or later`,
    };
  case 'http-error':
    return { kind: classifyHttpError(failure.status) === 'key-rejected' ? 'key-rejected' : 'read-failed', call: failure.call, detail: httpDetail(failure) };
  }
}

/** A 403 on archive is a key without the `workflow:delete` scope: it fails that workflow only, as any other refusal. */
function describeArchiveFailure(failure: ApiFailure): CleanFailure {
  if (failure.kind === 'http-error' && failure.status === 403) {
    return { kind: 'scope-missing', call: failure.call, detail: httpDetail(failure) };
  }
  const read = describeReadFailure(failure);
  return { kind: read.kind === 'read-failed' ? 'rejected' : read.kind, call: read.call, detail: read.detail };
}
