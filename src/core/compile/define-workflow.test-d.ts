import { assertType, describe, test } from 'vitest';
import { defineWorkflow } from '#src/core/compile/define-workflow';

const TRIGGER = {
  parameters: {},
  name: 'Start',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
} as const;

const SET = {
  parameters: { options: {} },
  name: 'Set message',
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position: [220, 0],
} as const;

describe('defineWorkflow', () => {
  test('Should accept a full n8n export when it is pasted as is', () => {
    assertType(
      defineWorkflow({
        name: 'Pasted export',
        nodes: [
          {
            parameters: {},
            id: '8f2c1a52-1d7e-4b0e-9a8a-0d6f3c2b1a01',
            name: 'When clicking ‘Execute workflow’',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
          },
          {
            parameters: { assignments: { assignments: [{ id: 'a1', name: 'message', value: 'Hi', type: 'string' }] } },
            id: '8f2c1a52-1d7e-4b0e-9a8a-0d6f3c2b1a02',
            name: 'Set message',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [220, 0],
            disabled: false,
          },
        ],
        connections: {
          'When clicking ‘Execute workflow’': { main: [[{ node: 'Set message', type: 'main', index: 0 }], null] },
        },
        settings: { executionOrder: 'v1' },
        pinData: {},
        meta: { instanceId: 'abc' },
        versionId: '1c2d',
        active: false,
        tags: [],
        id: 'wf1',
      }),
    );
  });

  test('Should reject a node when it has no typeVersion', () => {
    assertType(
      defineWorkflow({
        name: 'Missing typeVersion',
        // @ts-expect-error a node needs typeVersion
        nodes: [{ parameters: {}, name: 'Start', type: 'n8n-nodes-base.manualTrigger', position: [0, 0] }],
        connections: {},
      }),
    );
  });

  test('Should reject a connection when its target is not a node name', () => {
    assertType(
      defineWorkflow({
        name: 'Unknown target',
        nodes: [TRIGGER, SET],
        // @ts-expect-error "Set mesage" is not a node name
        connections: { Start: { main: [[{ node: 'Set mesage', type: 'main', index: 0 }]] } },
      }),
    );
  });

  test('Should reject a connection when its source is not a node name', () => {
    assertType(
      defineWorkflow({
        name: 'Unknown source',
        nodes: [TRIGGER, SET],
        connections: {
          // @ts-expect-error "Stat" is not a node name
          Stat: { main: [[{ node: 'Set message', type: 'main', index: 0 }]] },
        },
      }),
    );
  });

  test('Should reject the nodes when two of them share a name', () => {
    assertType(
      defineWorkflow({
        name: 'Duplicate name',
        // @ts-expect-error "Start" is used twice
        nodes: [TRIGGER, { ...SET, name: 'Start' }],
        connections: {},
      }),
    );
  });
});
