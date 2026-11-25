import { ManagedRead, StatusInput, StatusReads, StatusReport } from '#src/core/status/status.model';
import { decideStatus, readOrder, stopsStatus } from '#src/core/status/status.rules';

/**
 * Reads where each workflow stands on the instance, with GET calls only: one per workflow the lock file records
 * (ADR 0009), then every page of the workflow list for the ones it does not record. It never writes, to the instance or
 * to the lock file. The first failed call stops the reads. The states are decided by `decideStatus` (`status.rules.ts`).
 */
export async function readStatus(input: StatusInput): Promise<StatusReport> {
  return decideStatus(input, await readInstance(input));
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
