import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_UNREACHABLE } from '#src/core/common/exit-codes';
import { Result, err, ok } from '#src/core/common/result';
import { isSameContent } from '#src/core/deliver/normalize';
import { MIN_N8N_VERSION, classifyHttpError } from '#src/core/n8n/n8n-api';
import { ApiFailure, N8nWorkflow, WorkflowId } from '#src/core/n8n/n8n.model';
import {
  ManagedRead,
  ManagedStatus,
  RemovedStatus,
  StatusError,
  StatusInput,
  StatusReads,
  StatusReport,
  UnmanagedStatus,
  WorkflowStatus,
} from '#src/core/status/status.model';

/** The workflows of the project in the order status reads and shows them: by stable name. */
export function readOrder(workflows: LocalWorkflow[]): LocalWorkflow[] {
  return [...workflows].sort((a, b) => a.stableName.localeCompare(b.stableName));
}

/** Whether a failed read stops status: anything but a 404, which only means the recorded workflow is missing. */
export function stopsStatus(failure: ApiFailure): boolean {
  return !(failure.kind === 'http-error' && classifyHttpError(failure.status) === 'not-found');
}

/**
 * Decides where each workflow stands from what status read. Workflows of the project come first, in reading order,
 * then the removed entries by stable name, then the workflows the lock file does not record, archived ones only with
 * `--archived`, in the order n8n lists them. The first failed read stops status.
 */
export function decideStatus({ managed, removed, filter }: Pick<StatusInput, 'managed' | 'removed' | 'filter'>, reads: StatusReads): StatusReport {
  const statuses: WorkflowStatus[] = [];
  if (filter.managed) {
    for (const read of reads.managed) {
      const status = managedStatus(read);
      if (!status.ok) {
        return stopped(status.error);
      }
      statuses.push(status.value);
    }
    const gone = [...removed].sort(([a], [b]) => a.localeCompare(b));
    statuses.push(...gone.map(([stableName, id]): RemovedStatus => ({ state: 'removed', stableName, id })));
  }
  if (filter.unmanaged && reads.listed !== undefined) {
    if (!reads.listed.ok) {
      return stopped(describeFailure(reads.listed.error));
    }
    const recorded = new Set<WorkflowId>(managed.values());
    const others = reads.listed.value.body
      .filter(({ id, isArchived }) => !recorded.has(id) && (filter.archived || !isArchived))
      .map(({ id, name, isArchived }): UnmanagedStatus => ({ state: 'unmanaged', id, name, isArchived }));
    statuses.push(...others);
  }
  return { workflows: statuses, exitCode: EXIT_OK };
}

function managedStatus(read: ManagedRead): Result<ManagedStatus, StatusError> {
  const { workflow } = read;
  const local = { stableName: workflow.stableName, path: workflow.path, name: workflow.name };
  if (read.id === undefined) {
    return ok({ ...local, state: 'missing' });
  }
  const { id, draft } = read;
  if (!draft.ok) {
    return stopsStatus(draft.error) ? err(describeFailure(draft.error)) : ok({ ...local, state: 'missing', previousId: id });
  }
  return ok({ ...local, state: stateOf(workflow, draft.value.body), id });
}

function stateOf(local: LocalWorkflow, instance: N8nWorkflow): 'archived' | 'differs' | 'draft-pending' | 'up-to-date' {
  if (instance.isArchived) {
    return 'archived';
  }
  if (!isSameContent(local, instance)) {
    return 'differs';
  }
  const { versionId, activeVersionId } = instance;
  return activeVersionId === null || activeVersionId !== versionId ? 'draft-pending' : 'up-to-date';
}

function stopped(error: StatusError): StatusReport {
  return { workflows: [], error, exitCode: error.kind === 'key-rejected' ? EXIT_API_KEY_REJECTED : EXIT_UNREACHABLE };
}

/** What a failed read means for status. A rejected key exits 4; anything else exits 3, as an unreachable instance. */
function describeFailure(failure: ApiFailure): StatusError {
  switch (failure.kind) {
  case 'unreachable':
    return { kind: 'unreachable', call: failure.call, detail: `unreachable: ${failure.reason}` };
  case 'invalid-response':
    return {
      kind: 'unreachable',
      call: failure.call,
      detail: `unexpected answer (HTTP ${failure.status}): ${failure.detail}, check that the url points to n8n ${MIN_N8N_VERSION} or later`,
    };
  case 'http-error': {
    const detail = `HTTP ${failure.status}${failure.message === undefined ? '' : `: ${failure.message}`}`;
    return { kind: classifyHttpError(failure.status) === 'key-rejected' ? 'key-rejected' : 'read-failed', call: failure.call, detail };
  }
  }
}
