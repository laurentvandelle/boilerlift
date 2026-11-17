import { describe, expect, test } from 'vitest';
import { loadWorkflows } from '#src/core/compile/load-workflows';
import { fakeLocalWorkflow, fakeNode, fakeWorkflowFile } from '#src/core/compile/workflow.fake';
import { WorkflowFile } from '#src/core/compile/workflow.model';

describe('loadWorkflows', () => {
  test('Should return the workflows sorted by stable name when every file is valid', () => {
    const zeta = fakeLocalWorkflow('zeta', { path: 'workflows/a/zeta.json' });
    const alpha = fakeLocalWorkflow('alpha', { path: 'workflows/b/alpha.workflow.ts' });

    const result = loadWorkflows([fakeWorkflowFile(zeta), fakeWorkflowFile(alpha)]);

    expect(result).toEqual({ ok: true, value: [alpha, zeta] });
  });

  test('Should default settings to {} when the export has none', () => {
    const files: WorkflowFile[] = [{ path: 'workflows/plain.json', content: { name: 'Plain', nodes: [], connections: {} } }];

    const result = loadWorkflows(files);

    expect(result).toMatchObject({ ok: true, value: [{ stableName: 'plain', settings: {} }] });
  });

  test('Should take the stable name from the base name when the path uses backslashes', () => {
    const workflow = fakeLocalWorkflow('daily', { path: 'workflows\\win\\daily.json' });

    const result = loadWorkflows([fakeWorkflowFile(workflow)]);

    expect(result).toEqual({ ok: true, value: [workflow] });
  });

  test.each(['Invoice', 'with_underscore', 'seventeen-chars-x'])('Should reject the file when its stable name is %s', (name) => {
    const files = [fakeWorkflowFile(fakeLocalWorkflow('valid', { path: `workflows/${name}.json` }))];

    const result = loadWorkflows(files);

    expect(result).toMatchObject({ ok: false, error: [{ kind: 'invalid-name', path: `workflows/${name}.json` }] });
  });

  test('Should reject the second file and name the first when two files share a stable name across folders and extensions', () => {
    const files = [
      fakeWorkflowFile(fakeLocalWorkflow('sync', { path: 'workflows/crm/sync.json' })),
      fakeWorkflowFile(fakeLocalWorkflow('sync', { path: 'workflows/sync.workflow.ts' })),
    ];

    const result = loadWorkflows(files);

    expect(result).toEqual({
      ok: false,
      error: [
        {
          kind: 'duplicate-name',
          path: 'workflows/sync.workflow.ts',
          detail: 'stable name "sync" is also used by workflows/crm/sync.json; rename one of the two files',
        },
      ],
    });
  });

  test('Should report the read error when a file cannot be read', () => {
    const files: WorkflowFile[] = [{ path: 'workflows/broken.json', error: 'Unexpected token } in JSON' }];

    const result = loadWorkflows(files);

    expect(result).toEqual({
      ok: false,
      error: [{ kind: 'unreadable', path: 'workflows/broken.json', detail: 'cannot be read: Unexpected token } in JSON' }],
    });
  });

  test('Should name every missing field when the export lacks them', () => {
    const files: WorkflowFile[] = [{ path: 'workflows/empty.json', content: { nodes: {} } }];

    const result = loadWorkflows(files);

    expect(result).toEqual({
      ok: false,
      error: [
        {
          kind: 'invalid-shape',
          path: 'workflows/empty.json',
          detail: 'missing or invalid name (a string), nodes (an array), connections (an object)',
        },
      ],
    });
  });

  test('Should reject a .workflow.ts module when it has no default export', () => {
    const files: WorkflowFile[] = [{ path: 'workflows/nothing.workflow.ts', content: undefined }];

    const result = loadWorkflows(files);

    expect(result).toMatchObject({ ok: false, error: [{ kind: 'invalid-shape' }] });
  });

  test('Should keep the nodes and connections as they are when a full n8n export has unknown keys', () => {
    const nodes = [fakeNode(), fakeNode({ id: 'n2', name: 'Done', type: 'n8n-nodes-base.noOp', position: [220, 0], disabled: true })];
    const connections = { Start: { main: [[{ node: 'Done', type: 'main', index: 0 }], null] } };
    const content = { name: 'Full', nodes, connections, id: 'wf1', meta: { instanceId: 'x' }, pinData: {}, versionId: 'v1' };
    const files: WorkflowFile[] = [{ path: 'workflows/full.json', content }];

    const result = loadWorkflows(files);

    expect(result).toEqual({
      ok: true,
      value: [{ stableName: 'full', path: 'workflows/full.json', name: 'Full', nodes, connections, settings: {} }],
    });
  });

  test('Should name each invalid node by name, or else by index, when nodes lack fields', () => {
    const nodes = [{ ...fakeNode(), typeVersion: undefined, position: [0] }, { ...fakeNode({ type: 'n8n-nodes-base.noOp' }), name: undefined }, 'not a node'];
    const files: WorkflowFile[] = [{ path: 'workflows/nodes.json', content: { name: 'Nodes', nodes, connections: {} } }];

    const result = loadWorkflows(files);

    expect(result).toEqual({
      ok: false,
      error: [
        {
          kind: 'invalid-shape',
          path: 'workflows/nodes.json',
          detail:
            'node "Start" has a missing or invalid typeVersion (a number), position (two numbers); ' +
            'node at index 1 has a missing or invalid name (a non-empty string); ' +
            'node at index 2 must be an object',
        },
      ],
    });
  });

  test('Should report a duplicate node name once when three nodes share it', () => {
    const files = [fakeWorkflowFile(fakeLocalWorkflow('twice', { nodes: [fakeNode(), fakeNode(), fakeNode()] }))];

    const result = loadWorkflows(files);

    expect(result).toEqual({
      ok: false,
      error: [{ kind: 'invalid-shape', path: 'workflows/twice.json', detail: 'node name "Start" is used twice' }],
    });
  });

  test('Should name every bad connection when edges point to missing nodes or are malformed', () => {
    const connections = {
      Start: { main: [[{ node: 'Missing', type: 'main', index: 0 }]] },
      Ghost: { main: [[{ node: 'Start', type: 'main', index: 0 }]] },
      Broken: 'nope',
    };
    const files = [fakeWorkflowFile(fakeLocalWorkflow('edges', { path: 'workflows/edges.workflow.ts', connections }))];

    const result = loadWorkflows(files);

    expect(result).toEqual({
      ok: false,
      error: [
        {
          kind: 'invalid-shape',
          path: 'workflows/edges.workflow.ts',
          detail:
            'connection from "Start" to "Missing": no node named "Missing"; ' +
            'connection from "Ghost": no node named "Ghost"; ' +
            'connection from "Broken": no node named "Broken"; ' +
            'connection from "Broken" must map each output type to lists of { node, type, index }',
        },
      ],
    });
  });
});
