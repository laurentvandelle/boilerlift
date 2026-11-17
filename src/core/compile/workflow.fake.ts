import { isStableName } from '#src/core/compile/load-workflows';
import { LocalWorkflow, StableName, WorkflowFile, WorkflowNode } from '#src/core/compile/workflow.model';

/** A valid n8n node: a manual trigger named `Start`. */
export function fakeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'n1',
    name: 'Start',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [0, 0],
    parameters: {},
    ...overrides,
  };
}

/** `value` as a stable name, through the same guard as the loader. Throws when it breaks the stable-name rule. */
export function fakeStableName(value: string): StableName {
  if (!isStableName(value)) {
    throw new Error(`"${value}" is not a stable name: 1 to 16 of a-z, 0-9 and -`);
  }
  return value;
}

/** A local workflow, as `loadWorkflows` returns it, read from `workflows/{stableName}.json` unless `path` says otherwise. */
export function fakeLocalWorkflow(stableName: string, overrides: Partial<Omit<LocalWorkflow, 'stableName'>> = {}): LocalWorkflow {
  return {
    stableName: fakeStableName(stableName),
    path: `workflows/${stableName}.json`,
    name: `Workflow ${stableName}`,
    nodes: [fakeNode()],
    connections: {},
    settings: { executionOrder: 'v1' },
    ...overrides,
  };
}

/** The workflow file that `loadWorkflows` turns into `workflow`: its n8n export, at its path. */
export function fakeWorkflowFile({ path, name, nodes, connections, settings }: LocalWorkflow): WorkflowFile {
  return { path, content: { name, nodes, connections, settings } };
}
