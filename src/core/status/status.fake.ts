import { fakeLocalWorkflow } from '#src/core/compile/workflow.fake';
import { fakeWorkflowId } from '#src/core/n8n/n8n.fake';
import { ManagedStatus } from '#src/core/status/status.model';

/** Where the workflow file `stableName` stands, as `readStatus` reports it: deployed under `id` unless `missing`. */
export function fakeManagedStatus(stableName: string, state: ManagedStatus['state'], id = `${stableName}-id`): ManagedStatus {
  const { path, name } = fakeLocalWorkflow(stableName);
  const local = { stableName: fakeLocalWorkflow(stableName).stableName, path, name };
  return state === 'missing' ? { ...local, state } : { ...local, state, id: fakeWorkflowId(id) };
}
