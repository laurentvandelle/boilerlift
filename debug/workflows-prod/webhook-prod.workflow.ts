// The workflow of the prod target. Its webhook picks the credential of key
// 'global-apikey-for-webhook-node' with credential(): deploy sends the id and name that
// credentials/prod.ts gives that key. Run `npm start -- creds sync --target prod` first, then
// `npm start -- deploy --target prod`. Without the list, or with a key the instance lacks,
// deploy stops before writing and names the missing credential.
import { credential, defineWorkflow } from 'boilerlift';

export default defineWorkflow({
  name: 'Boilerlift webhook (prod)',
  nodes: [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'boilerlift-webhook-prod',
        authentication: 'headerAuth',
        options: {},
      },
      id: '3b7d9e10-5c2a-4f6e-8d1b-7a9c0e2f4b01',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      webhookId: '3b7d9e10-5c2a-4f6e-8d1b-7a9c0e2f4b02',
      credentials: credential('global-apikey-for-webhook-node'),
    },
    {
      parameters: {
        assignments: {
          assignments: [
            { id: 'a1', name: 'message', value: 'Hello from the prod target', type: 'string' },
          ],
        },
        options: {},
      },
      id: '3b7d9e10-5c2a-4f6e-8d1b-7a9c0e2f4b03',
      name: 'Set message',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [220, 0],
    },
  ],
  connections: {
    Webhook: {
      main: [[{ node: 'Set message', type: 'main', index: 0 }]],
    },
  },
  settings: { executionOrder: 'v1' },
});
