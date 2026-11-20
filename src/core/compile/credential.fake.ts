import { CredentialEntry, CredentialMarker } from '#src/core/compile/credential.model';
import { fakeLocalWorkflow, fakeNode } from '#src/core/compile/workflow.fake';
import { LocalWorkflow, WorkflowFile } from '#src/core/compile/workflow.model';

/** What `credential(key)` stores in a node whose list gives `key` the type `type`. */
export function fakeCredentialSlot(key: string, type = 'httpHeaderAuth'): Record<string, CredentialMarker> {
  return { [type]: { boilerlift: 'credential', key } };
}

/** A workflow file at `path` with one node per key, named `Node 1`, `Node 2`…, each picking its key with `credential()`. */
export function fakeWorkflowFileUsing(path: string, keys: readonly string[], type = 'httpHeaderAuth'): WorkflowFile {
  const nodes = keys.map((key, index) => fakeNode({ id: `n${index + 1}`, name: `Node ${index + 1}`, credentials: fakeCredentialSlot(key, type) }));
  return { path, content: { name: `Workflow ${path}`, nodes, connections: {} } };
}

/** A local workflow with one node per key, named `Node 1`, `Node 2`…, each picking its key with `credential()`. */
export function fakeLocalWorkflowUsing(stableName: string, keys: readonly string[], type = 'httpHeaderAuth'): LocalWorkflow {
  const nodes = keys.map((key, index) => fakeNode({ id: `n${index + 1}`, name: `Node ${index + 1}`, credentials: fakeCredentialSlot(key, type) }));
  return fakeLocalWorkflow(stableName, { nodes });
}

/** An entry of a credential list, as `lift creds sync` writes it: its key is `name`, its id `<name>-id`. */
export function fakeCredentialEntry(name: string, overrides: Partial<CredentialEntry> = {}): CredentialEntry {
  return { key: name, name, type: 'httpHeaderAuth', id: `${name}-id`, ...overrides };
}
