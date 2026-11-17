import { describe, expect, test } from 'vitest';
import { defineWorkflow } from '#src/core/compile/define-workflow';
import { fakeNode } from '#src/core/compile/workflow.fake';

describe('defineWorkflow', () => {
  test('Should return the workflow unchanged when it is valid', () => {
    const workflow = {
      name: 'Demo',
      nodes: [fakeNode(), fakeNode({ id: 'n2', name: 'Set message', type: 'n8n-nodes-base.set' })],
      connections: { Start: { main: [[{ node: 'Set message', type: 'main', index: 0 }]] } },
    };

    const result = defineWorkflow(workflow);

    expect(result).toBe(workflow);
  });
});
