import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { EXIT_API_KEY_REJECTED, EXIT_OK, EXIT_UNREACHABLE } from '#src/core/common/exit-codes';
import { Result, err, ok } from '#src/core/common/result';
import { isSameContent } from '#src/core/deliver/normalize';
import { MIN_N8N_VERSION, classifyHttpError } from '#src/core/n8n/n8n-api';
import { ApiFailure, N8nClient, N8nWorkflow, WorkflowId } from '#src/core/n8n/n8n.model';
import { ManagedStatus, StatusError, StatusInput, StatusReport, UnmanagedStatus, WorkflowStatus } from '#src/core/status/status.model';

/**
 * Reads where each workflow stands on the instance, with GET calls only: one per workflow the lock file records
 * (ADR 0009), then every page of the workflow list for the ones it does not record. It never writes, to the instance or
 * to the lock file. Workflows of the project come first, in stable-name order, then the others in the order n8n lists
 * them. The first failed call stops status.
 */
export async function readStatus({ workflows, client, managed, filter }: StatusInput): Promise<StatusReport> {
  const statuses: WorkflowStatus[] = [];
  if (filter.managed) {
    for (const workflow of [...workflows].sort((a, b) => a.stableName.localeCompare(b.stableName))) {
      const status = await managedStatus(workflow, managed.get(workflow.stableName), client);
      if (!status.ok) {
        return stopped(status.error);
      }
      statuses.push(status.value);
    }
  }
  if (filter.unmanaged) {
    const listed = await client.listWorkflows();
    if (!listed.ok) {
      return stopped(describeFailure(listed.error));
    }
    const recorded = new Set<WorkflowId>(managed.values());
    const others = listed.value.body
      .filter(({ id, isArchived }) => !recorded.has(id) && (filter.archived || !isArchived))
      .map(({ id, name, isArchived }): UnmanagedStatus => ({ state: 'unmanaged', id, name, isArchived }));
    statuses.push(...others);
  }
  return { workflows: statuses, exitCode: EXIT_OK };
}

async function managedStatus(
  workflow: LocalWorkflow,
  id: WorkflowId | undefined,
  client: N8nClient,
): Promise<Result<ManagedStatus, StatusError>> {
  const local = { stableName: workflow.stableName, path: workflow.path, name: workflow.name };
  if (id === undefined) {
    return ok({ ...local, state: 'missing' });
  }
  const draft = await client.getWorkflow(id);
  if (!draft.ok) {
    if (draft.error.kind === 'http-error' && classifyHttpError(draft.error.status) === 'not-found') {
      return ok({ ...local, state: 'missing', previousId: id });
    }
    return err(describeFailure(draft.error));
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
