# Manual install

Set up Boilerlift yourself, without an AI agent. To let an agent do it with you, paste the prompt of the [README](../README.md) instead.

Requires Node.js 22.18 or later, and n8n 2.35.0 or later.

## Install

```sh
npm install -g boilerlift
```

This installs the `lift` command (`boilerlift` is an alias). It is optional: in a project, `npx lift` runs the copy the project installed.

## Quick start

1. Start a project with [`lift init`](commands/init.md), then install its dependencies:

   ```sh
   npx boilerlift init my-n8n-workflows
   cd my-n8n-workflows
   npm install
   ```

   It writes `boilerlift.config.ts` with one target, `dev`, an example workflow `workflows/hello.workflow.ts`, `.env.example` and the Agent kit. To build the project by hand instead, see [Without `lift init`](#without-lift-init).

2. Copy `.env.example` to `.env` (git-ignored), then set `N8N_URL` and `N8N_API_KEY` (n8n → Settings → n8n API):

   ```sh
   N8N_URL=https://your-n8n.example.com
   N8N_API_KEY=your-api-key
   ```

3. Check the connection:

   ```sh
   npx lift ping
   ```

4. See what a deploy would do, without writing anything:

   ```sh
   npx lift deploy --dry-run
   ```

   Then run `npx lift deploy` to deliver it as a draft, and `npx lift publish` to publish it.

## Without `lift init`

1. Install Boilerlift in your project, so workflow files can import it:

   ```sh
   npm install --save-dev boilerlift
   ```

2. Create `boilerlift.config.ts` at the project root, with one target:

   ```ts
   import { defineConfig } from 'boilerlift';

   export default defineConfig({
     targets: {
       dev: { url: process.env.N8N_URL, apiKey: process.env.N8N_API_KEY, workflows: './workflows' },
     },
   });
   ```

3. Set `N8N_URL` and `N8N_API_KEY` in `.env` (keep it out of Git):

   ```sh
   N8N_URL=https://your-n8n.example.com
   N8N_API_KEY=your-api-key
   ```

4. Check the connection:

   ```sh
   lift ping
   ```

5. Add a tiny workflow, `workflows/hello.workflow.ts`:

   ```ts
   import { defineWorkflow } from 'boilerlift';

   export default defineWorkflow({
     name: 'Hello',
     nodes: [{ parameters: {}, name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0] }],
     connections: {},
   });
   ```

6. See what a deploy would do, without writing anything:

   ```sh
   lift deploy --dry-run
   ```

   Then run `lift deploy` to deliver it as a draft, and `lift publish` to publish it.
