import { StableName } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_UNREACHABLE } from '#src/cli/exit-codes';
import { Result, err, ok } from '#src/core/common/result';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { LockRemover } from '#src/core/lock/lock-file.model';
import { MIN_N8N_VERSION, classifyHttpError } from '#src/core/n8n/n8n-api';
import { ApiFailure, N8nClient, WorkflowId } from '#src/core/n8n/n8n.model';
import {
  RemovalFailure,
  RemovalMode,
  RemovalReadError,
  RemovalReport,
  RemovalResult,
  RemovalWriteCause,
  WorkflowToRemove,
} from '#src/core/removal/removal.model';

/**
 * Reads where each of `entries` stands on n8n, with one GET per workflow, by the id the lock file records (ADR 0009),
 * in stable-name order. It never writes. The first failed read stops it. In `delete` mode, every workflow still on the
 * instance is `to-delete`.
 */
export async function readWorkflowsToRemove(
  client: N8nClient,
  entries: ReadonlyMap<StableName, WorkflowId>,
  mode: RemovalMode,
): Promise<Result<WorkflowToRemove[], RemovalReadError>> {
  const found: WorkflowToRemove[] = [];
  for (const [stableName, id] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const read = await client.getWorkflow(id);
    if (read.ok) {
      const { name, isArchived } = read.value.body;
      switch (mode) {
      case 'archive':
        found.push({ stableName, id, name, state: isArchived ? 'already-archived' : 'to-archive' });
        break;
      case 'delete':
        found.push({ stableName, id, name, state: 'to-delete', isArchived });
        break;
      }
    } else if (isNotFound(read.error)) {
      found.push({ stableName, id, state: 'not-found' });
    } else {
      return err(describeReadFailure(read.error));
    }
  }
  return ok(found);
}

/** The exit code of a read that stopped a removal before any write: 4 for a rejected API key, 3 otherwise. */
export function readStopExitCode(error: RemovalReadError): typeof EXIT_UNREACHABLE | typeof EXIT_API_KEY_REJECTED {
  return error.kind === 'key-rejected' ? EXIT_API_KEY_REJECTED : EXIT_UNREACHABLE;
}

/**
 * Archives each workflow that is still on the instance, in order, or for a `to-delete` one archives it when it is not
 * archived yet, then deletes it for good. It drops the lock entry of each one archived, already archived, deleted or
 * not found, through `remover`. A failure fails only that workflow and keeps its entry; the others are still removed,
 * and the outcome is `partial`.
 */
export async function applyRemoval(workflows: WorkflowToRemove[], client: N8nClient, instance: string, remover: LockRemover): Promise<RemovalReport> {
  const results: RemovalResult[] = [];
  for (const workflow of workflows) {
    results.push(await removeOne(workflow, client, instance, remover));
  }
  return { results, outcome: results.some(({ action }) => action === 'failed') ? 'partial' : 'completed' };
}

/** What the writes on one workflow came to before its lock entry is dropped: an action, or the failure that keeps it. */
type Written = { action: 'archived' | 'already-archived' | 'deleted' | 'not-found' } | { action: 'failed'; error: RemovalFailure };

async function removeOne(workflow: WorkflowToRemove, client: N8nClient, instance: string, remover: LockRemover): Promise<RemovalResult> {
  const { stableName, id } = workflow;
  const name = workflow.state === 'not-found' ? null : workflow.name;
  const written = await write(workflow, client);
  if (written.action === 'failed') {
    return { stableName, id, name, ...written };
  }
  const { action } = written;
  const dropped = await remover.remove(instance, stableName);
  if (!dropped.ok) {
    return {
      stableName,
      id,
      name,
      action: 'failed',
      error: {
        kind: 'lock-write-failed',
        call: `write ${LOCK_FILE}`,
        detail: `workflow ${id} ${DONE[action]}, but ${LOCK_FILE} could not be written: ${dropped.error.reason}`,
      },
    };
  }
  return { stableName, id, name, action };
}

const DONE: Record<'archived' | 'already-archived' | 'deleted' | 'not-found', string> = {
  archived: 'was archived',
  'already-archived': 'is already archived',
  deleted: 'was deleted',
  'not-found': 'is not on n8n',
};

/** The writes one workflow needs on n8n, by its state. A 404 on any of them means it is gone already: `not-found`. */
async function write(workflow: WorkflowToRemove, client: N8nClient): Promise<Written> {
  switch (workflow.state) {
  case 'already-archived':
  case 'not-found':
    return { action: workflow.state };
  case 'to-archive':
    return archive(workflow.id, client);
  case 'to-delete': {
    if (!workflow.isArchived) {
      const archived = await archive(workflow.id, client);
      if (archived.action !== 'archived') {
        return archived;
      }
    }
    const deleted = await client.deleteWorkflow(workflow.id);
    if (deleted.ok) {
      return { action: 'deleted' };
    }
    if (isNotFound(deleted.error)) {
      return { action: 'not-found' };
    }
    const { call, detail, cause } = describeWriteFailure(deleted.error);
    return { action: 'failed', error: { kind: 'delete-failed', cause, call, detail } };
  }
  }
}

async function archive(id: WorkflowId, client: N8nClient): Promise<Written> {
  const archived = await client.archiveWorkflow(id);
  if (archived.ok) {
    return { action: 'archived' };
  }
  if (isNotFound(archived.error)) {
    return { action: 'not-found' };
  }
  const { call, detail, cause } = describeWriteFailure(archived.error);
  return { action: 'failed', error: { kind: cause, call, detail } };
}

function isNotFound(failure: ApiFailure): boolean {
  return failure.kind === 'http-error' && classifyHttpError(failure.status) === 'not-found';
}

function httpDetail(failure: { status: number; message?: string }): string {
  return `HTTP ${failure.status}${failure.message === undefined ? '' : `: ${failure.message}`}`;
}

/** A failed read, as the error that stops a removal before any write. */
export function describeReadFailure(failure: ApiFailure): RemovalReadError {
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

/**
 * A 403 on an archive or a delete is a key without the `workflow:delete` scope: it fails that workflow only, as any
 * other refusal.
 */
function describeWriteFailure(failure: ApiFailure): { cause: RemovalWriteCause; call: string; detail: string } {
  if (failure.kind === 'http-error' && failure.status === 403) {
    return { cause: 'scope-missing', call: failure.call, detail: httpDetail(failure) };
  }
  const read = describeReadFailure(failure);
  return { cause: read.kind === 'read-failed' ? 'rejected' : read.kind, call: read.call, detail: read.detail };
}
