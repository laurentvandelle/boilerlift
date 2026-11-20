import { CredentialMarker } from '#src/core/compile/credential.model';
import { fakeNode } from '#src/core/compile/workflow.fake';
import { WorkflowFile } from '#src/core/compile/workflow.model';

/** What `credential(key)` stores in a node whose list gives `key` the type `type`. */
export function fakeCredentialSlot(key: string, type = 'httpHeaderAuth'): Record<string, CredentialMarker> {
  return { [type]: { boilerlift: 'credential', key } };
}

/** A workflow file at `path` with one node per key, named `Node 1`, `Node 2`…, each picking its key with `credential()`. */
export function fakeWorkflowFileUsing(path: string, keys: readonly string[], type = 'httpHeaderAuth'): WorkflowFile {
  const nodes = keys.map((key, index) => fakeNode({ id: `n${index + 1}`, name: `Node ${index + 1}`, credentials: fakeCredentialSlot(key, type) }));
  return { path, content: { name: `Workflow ${path}`, nodes, connections: {} } };
}
