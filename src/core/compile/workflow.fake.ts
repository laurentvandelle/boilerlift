import { LocalWorkflow, WorkflowFile, WorkflowNode } from '#src/core/compile/workflow.model';

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

/** A local workflow, as `loadWorkflows` returns it, read from `workflows/{stableName}.json` unless `path` says otherwise. */
export function fakeLocalWorkflow(stableName: string, overrides: Partial<LocalWorkflow> = {}): LocalWorkflow {
  return {
    stableName,
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
