// A first workflow: a manual trigger, then a Set node. Its stable name is the file name: `hello`.
// Replace it with an export from the n8n editor (⋯ → Download), pasted into defineWorkflow.
import { defineWorkflow } from 'boilerlift';

export default defineWorkflow({
  name: 'Hello from Boilerlift',
  nodes: [
    {
      parameters: {},
      id: '3b0d6c1e-6f43-4f5a-9d2e-1a7c5e8b9f01',
      name: 'When clicking ‘Execute workflow’',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
    },
    {
      parameters: {
        assignments: {
          assignments: [{ id: 'message', name: 'message', value: 'Hello from Boilerlift', type: 'string' }],
        },
        options: {},
      },
      id: '3b0d6c1e-6f43-4f5a-9d2e-1a7c5e8b9f02',
      name: 'Set message',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [220, 0],
    },
  ],
  connections: {
    'When clicking ‘Execute workflow’': {
      main: [[{ node: 'Set message', type: 'main', index: 0 }]],
    },
  },
  settings: { executionOrder: 'v1' },
});
