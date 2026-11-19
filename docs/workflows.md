# Write a workflow

A workflow file is an n8n export, typed. Export a workflow from n8n (editor → ⋯ → Download), then paste the JSON into `defineWorkflow` in a `.workflow.ts` file under the workflows folder of your target (see [Configure your targets](configuration.md)). A plain `.json` export in that folder works too.

```ts
// workflows/invoice-sync.workflow.ts
import { defineWorkflow } from 'boilerlift';

export default defineWorkflow({
  name: 'Invoice sync',
  nodes: [
    { parameters: {}, name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0] },
    { parameters: {}, name: 'Done', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [220, 0] },
  ],
  connections: { Start: { main: [[{ node: 'Done', type: 'main', index: 0 }]] } },
});
```

Install Boilerlift as a dev dependency of the project, so the file can import `defineWorkflow`:

```sh
npm install --save-dev boilerlift
```

## What the editor checks

`defineWorkflow` returns the export unchanged. Your editor (TypeScript 5.4 or later) flags:

- a node missing `name`, `type`, `typeVersion`, `position` (two numbers) or `parameters`;
- a connection from or to a node name that is not in `nodes`;
- a node name used twice.

Other keys of the export (`id`, `meta`, `pinData`, `versionId`, `credentials`…) are accepted as they are. `Workflow`, `WorkflowNode` and `WorkflowConnection` are exported for your own code. The types live in [`src/core/compile/`](../src/core/compile/), and [`src/core/compile/define-workflow.test-d.ts`](../src/core/compile/define-workflow.test-d.ts) shows what each rule accepts and rejects.

`lift deploy` checks every file, `.workflow.ts` and `.json` alike, with the same rules before anything is sent: see [`lift deploy`](commands/deploy.md).

## Stable name

The file name without `.workflow.ts` / `.json` is the workflow's **stable name**: 1 to 64 lowercase letters, digits or dashes, unique across all folders. It is how Boilerlift links the file to the workflow on the instance (see [the lock file](commands/deploy.md#the-lock-file)). Renaming the file makes a new workflow.

Workflows are plain TypeScript: lint, typecheck and test them in CI like any other file of your project.
