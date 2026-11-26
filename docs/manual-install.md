# Manual install

Set up Boilerlift yourself, without an AI agent. To let an agent do it with you, paste the prompt of the [README](../README.md) instead.

Requires Node.js 22.18 or later, and n8n 2.35.0 or later. `lift init` also needs [git](https://git-scm.com/downloads) and a network connection: it downloads the Project template with git.

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
   git init
   npm install
   ```

   It creates the folder, which must be new or empty, with `boilerlift.config.ts` and one target, `dev`, an example workflow `workflows/hello.workflow.ts`, `.env.example` and the Agent kit. To start without `lift init`, see [Without `lift init`](#without-lift-init).

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

The Project template is a GitHub template repository: open [boilerlift-template](https://github.com/laurentvandelle/boilerlift-template) and click **Use this template** to create your own repository from it. It gives `main`, the template of the latest version of Boilerlift: the same files `lift init` of that version writes.

Then clone your new repository, and follow the [Quick start](#quick-start) from step 2, after `npm install`.
