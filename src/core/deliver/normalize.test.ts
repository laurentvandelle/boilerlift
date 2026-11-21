import { describe, expect, test } from 'vitest';
import { fakeLocalWorkflow, fakeNode } from '#src/core/compile/workflow.fake';
import { isSameContent } from '#src/core/deliver/normalize';
import { fakeN8nWorkflow } from '#src/core/n8n/n8n.fake';
import { N8nWorkflow } from '#src/core/n8n/n8n.model';

const LOCAL = fakeLocalWorkflow('crm', {
  name: 'CRM',
  nodes: [
    fakeNode({ id: 'l2', name: 'Slack', type: 'slack', credentials: { slackApi: { id: 'dev-1', name: 'Slack bot' } } }),
    fakeNode({ id: 'l1', name: 'Hook', type: 'webhook', webhookId: 'local-hook' }),
  ],
  connections: { Hook: { main: [[{ node: 'Slack', type: 'main', index: 0 }]] } },
});

/** The instance's current draft of LOCAL: other node ids, nodes and keys in another order, and server-only settings. */
function draftOfLocal(overrides: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return fakeN8nWorkflow(LOCAL, {
    nodes: [
      { parameters: {}, webhookId: 'server-hook', type: 'webhook', name: 'Hook', id: 's1', typeVersion: 1, position: [0, 0] },
      {
        name: 'Slack',
        position: [0, 0],
        type: 'slack',
        id: 's2',
        typeVersion: 1,
        parameters: {},
        credentials: { slackApi: { name: 'Slack bot', id: 'dev-1' } },
      },
    ],
    connections: { Hook: { main: [[{ index: 0, type: 'main', node: 'Slack' }]] } },
    settings: { executionOrder: 'v1', redactionPolicy: 'none', saveManualExecutions: true },
    ...overrides,
  });
}

describe('isSameContent', () => {
  test('Should find the same content when the draft differs only in node ids, node and key order and server-only settings', () => {
    const draft = draftOfLocal();

    const same = isSameContent(LOCAL, draft);

    expect(same).toBe(true);
  });

  test.each<[string, Partial<N8nWorkflow>]>([
    ['the name', { name: 'CRM renamed' }],
    ['a setting the file sets', { settings: { executionOrder: 'v0' } }],
    ['the connections', { connections: {} }],
    ['a credential name', { nodes: [{ name: 'Hook', type: 'webhook' }, { name: 'Slack', type: 'slack', credentials: { slackApi: { name: 'Other' } } }] }],
    [
      'a credential id under the same name',
      {
        nodes: [
          { parameters: {}, type: 'webhook', name: 'Hook', typeVersion: 1, position: [0, 0] },
          { parameters: {}, type: 'slack', name: 'Slack', typeVersion: 1, position: [0, 0], credentials: { slackApi: { id: 'new-1', name: 'Slack bot' } } },
        ],
      },
    ],
  ])('Should see a change when the draft differs in %s', (_difference, overrides) => {
    const draft = draftOfLocal(overrides);

    const same = isSameContent(LOCAL, draft);

    expect(same).toBe(false);
  });
});
