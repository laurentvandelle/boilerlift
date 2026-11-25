import { resolveCredentials } from '#src/core/deliver/resolve-credentials';
import { ManagedRead, StatusInput, StatusReads, StatusReport } from '#src/core/status/status.model';
import { credentialStop, decideStatus, readOrder, stopsStatus } from '#src/core/status/status.rules';

/**
 * Reads where each workflow stands on the instance, with GET calls only: one per workflow the lock file records
 * (ADR 0009), then every page of the workflow list for the ones it does not record. It never writes, to the instance or
 * to the lock file. The first failed call stops the reads. The states are decided by `decideStatus` (`status.rules.ts`).
 * When the workflows of the project are shown, their `credential()` markers first resolve through the credential list
 * of the target (`resolveCredentials`, shared with deploy), so a draft deploy wrote compares equal to its file. A
 * marker that does not resolve stops status before any workflow is read. No marker: no `GET /credentials`.
 */
export async function readStatus(input: StatusInput): Promise<StatusReport> {
  if (!input.filter.managed) {
    return decideStatus(input, await readInstance(input));
  }
  const { workflows, client, target, credentials, command } = input;
  const resolved = await resolveCredentials({ workflows, client, target, credentials, command });
  if (!resolved.ok) {
    return credentialStop(resolved.error);
  }
  return decideStatus(input, await readInstance({ ...input, workflows: resolved.value }));
}

async function readInstance({ workflows, client, managed, filter }: StatusInput): Promise<StatusReads> {
  const reads: ManagedRead[] = [];
  if (filter.managed) {
    for (const workflow of readOrder(workflows)) {
      const id = managed.get(workflow.stableName);
      if (id === undefined) {
        reads.push({ workflow });
        continue;
      }
      const draft = await client.getWorkflow(id);
      reads.push({ workflow, id, draft });
      if (!draft.ok && stopsStatus(draft.error)) {
        return { managed: reads };
      }
    }
  }
  return filter.unmanaged ? { managed: reads, listed: await client.listWorkflows() } : { managed: reads };
}
