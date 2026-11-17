# n8nlift

**Code is the source. n8n is the runtime.**

Write n8n workflows in TypeScript, test them like any other code, and lift them from dev to prod.

n8nlift is a command-line tool for people who want their n8n workflows to live in Git, not only in the editor. You paste an n8n export into a typed `.workflow.ts` file, let the editor catch a broken shape, run unit tests, then deploy to your n8n instance. Updates land as drafts, so the published version keeps running until you choose to publish.

## Why n8nlift

- **Typed workflow files.** Paste an n8n export into `defineWorkflow`: the editor flags a missing node field, a connection to a node that does not exist, or a node name used twice, before anything is deployed.
- **Tested before shipped.** Workflows are plain TypeScript: lint, typecheck and test them in CI.
- **Safe delivery.** Deploy as draft, review, then publish. Requires n8n 2.35.0 or later.
- **Built for AI coding agents.** Agents edit code and run the CLI instead of calling the n8n API directly.
- **Your instance, your rules.** n8nlift talks to your own n8n instance through its public API. Nothing is hosted for you.

## Install

```sh
npm install -g n8nlift
```

Requires Node.js 22.18 or later, and n8n 2.35.0 or later.

In a project whose workflows are `.workflow.ts` files, also install it as a dev dependency, so the files can import `defineWorkflow`:

```sh
npm install --save-dev n8nlift
```

## Quick start

```sh
n8nlift --help            # list the available commands
n8nlift ping              # check the connection to your n8n instance
n8nlift deploy            # deliver ./workflows to your instance as drafts
n8nlift deploy --dry-run  # show what deploy would do, write nothing
n8nlift help <command>    # show the options of one command
n8nlift --version         # print the installed version
```

## Check your connection

Before deploying anything, check that your project can reach your n8n instance. `n8nlift ping` reads two values from the environment, then from a `.env` file in the current folder. A variable set in the environment wins over `.env`.

| Variable      | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| `N8N_URL`     | Root URL of your n8n instance. n8nlift adds `/api/v1` itself.    |
| `N8N_API_KEY` | An n8n API key, created in n8n → Settings → n8n API.             |

```sh
# .env — keep it out of Git
N8N_URL=https://your-n8n.example.com
N8N_API_KEY=your-n8n-api-key
```

Add the script to your project's `package.json`, then run `npm run ping`:

```json
{
  "scripts": {
    "ping": "n8nlift ping"
  }
}
```

`ping` is read-only. It checks, in order, that Node.js is 22.18 or later, that the instance answers on `GET /healthz`, and that the public API accepts your key (`GET /api/v1/workflows`). After a failed check the next ones are skipped, and each failure prints the next step. The key is never printed. An `http://` URL gets a warning, because the key travels unencrypted.

| Exit code | Meaning                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Every check passed                                                                                                                                |
| 1         | Usage error, missing `N8N_URL` / `N8N_API_KEY`, an `N8N_URL` that is not `http://` or `https://`, or an unexpected error (printed with its stack) |
| 2         | Node.js is older than 22.18                                                                                                                       |
| 3         | The instance or its public API cannot be reached                                                                                                  |
| 4         | The API key is rejected                                                                                                                           |

> Requires n8n 2.35.0 or later. `ping` cannot check this: the n8n API doesn't expose its version. `deploy` checks it before writing anything, from the API spec the instance serves.

## Write a workflow

Export a workflow from n8n (editor → ⋯ → Download), then paste the JSON into `defineWorkflow` in a `.workflow.ts` file under `./workflows`:

```ts
// workflows/invoice-sync.workflow.ts
import { defineWorkflow } from 'n8nlift';

export default defineWorkflow({
  name: 'Invoice sync',
  nodes: [
    { parameters: {}, name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0] },
    { parameters: {}, name: 'Done', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [220, 0] },
  ],
  connections: { Start: { main: [[{ node: 'Done', type: 'main', index: 0 }]] } },
});
```

`defineWorkflow` returns the export unchanged. Your editor (TypeScript 5.4 or later) flags:

- a node missing `name`, `type`, `typeVersion`, `position` (two numbers) or `parameters`;
- a connection from or to a node name that is not in `nodes`;
- a node name used twice.

Other keys of the export (`id`, `meta`, `pinData`, `versionId`, `credentials`…) are accepted as they are. `Workflow`, `WorkflowNode` and `WorkflowConnection` are exported for your own code.

## Deploy

`n8nlift deploy` delivers every workflow under `./workflows` to your instance. It reads the same `N8N_URL` and `N8N_API_KEY` as `ping`.

```text
workflows/
  invoice-sync.workflow.ts   # export default <workflow pasted from an n8n export>
  crm/crm-import.json        # a workflow exported from n8n
```

Before anything is sent, `deploy` checks every file, `.workflow.ts` and `.json` alike, with the same rules as the editor: the workflow has a `name`, `nodes` and `connections`; every node has `name`, `type`, `typeVersion`, `position` and `parameters`; node names are unique; every connection goes from and to an existing node. One wrong file refuses the whole run, names the file and what is wrong, and exits 1.

The file name without `.workflow.ts` / `.json` is the workflow's **stable name**: 1 to 16 lowercase letters, digits or dashes, unique across all folders. n8nlift tags the workflow `n8nlift:<stable-name>` on the instance and finds it again by that tag, so renaming the workflow in n8n keeps the link (the name in the file wins on the next update); renaming the file makes a new workflow.

```text
n8nlift deploy → https://your-n8n.example.com
~ updated       crm-import     workflows/crm/crm-import.json (draft; published version still running)
= skipped       daily-report   unchanged
+ created       invoice-sync   workflows/invoice-sync.workflow.ts
! restored      lead-scoring   workflows/lead-scoring.json (unpublished draft)
⚠ lead-scoring: workflow 7Hq2 was archived in n8n; it is back as an unpublished draft
1 created, 1 updated, 1 restored, 1 skipped, 0 failed. Drafts are not live until you publish them.
```

- Before any write, `deploy` reads the instance's API spec (`GET /api/v1/openapi.yml`). If the instance cannot save drafts (older than n8n 2.35.0), it stops, changes nothing and exits 6.
- New workflows are created and never published.
- Changed workflows are updated as drafts: the published version keeps running until you publish in n8n.
- Workflows whose current draft already matches the file are skipped, so a rerun changes nothing.
- A workflow deleted in the n8n editor is only archived. `deploy` unarchives it and updates it as a draft (`restored`), with a warning: it stays unpublished until you publish it. This needs the `workflow:delete` scope on the API key. A workflow deleted through the API is gone for good and is simply created again.
- When an archived copy and an unarchived workflow carry the same tag, the unarchived one is used and a warning names the archived copy.
- A failure on one workflow marks it `✗ failed`, with the failed call and the next step below its line, and the others are still delivered. Two unarchived workflows with the same `n8nlift:` tag fail only that stable name.
- An unreachable instance or a rejected key stops the run: the workflows not yet processed are listed as `not-processed`.
- After the summary, stderr recaps the failed and not-processed workflows and the next step.
- `--json` prints the same report as JSON, for scripts and AI agents: each result has an `action` (`created`, `updated`, `skipped`, `restored`, `failed`, `not-processed`) and, when it failed, an `error` with `call`, `detail` and `hint`; plus `dryRun` (`true` under `--dry-run`), `summary`, `warnings`, `exitCode`, and a top-level `error` only when the whole run stopped.

| Exit code | Meaning                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0         | Every workflow delivered, or nothing to deploy                                                                         |
| 1         | Usage error, missing or invalid configuration, invalid workflow files, or an unexpected error (printed with its stack) |
| 3         | The instance cannot be reached, or does not answer like the n8n public API                                             |
| 4         | The API key is rejected                                                                                                |
| 5         | At least one workflow failed; the others were delivered                                                                |
| 6         | The instance is older than n8n 2.35.0: nothing was written                                                             |

### Dry run

`n8nlift deploy --dry-run` reads the instance and shows what `deploy` would do, without writing anything: each workflow is listed as `would create`, `would update`, `would restore`, `would skip` or `would fail`, and blockers (unreachable instance, rejected key, n8n older than 2.35.0) show as they would on a real deploy. The exit codes are the same. A real deploy does the same reads first, so the preview is what it would do right after.

```text
n8nlift deploy --dry-run → https://your-n8n.example.com
~ would update  crm-import     workflows/crm/crm-import.json (draft; published version still running)
= would skip    daily-report   unchanged
+ would create  invoice-sync   workflows/invoice-sync.workflow.ts
Would: 1 create, 1 update, 0 restore, 1 skip, 0 fail.
Dry run: nothing was written. Run n8nlift deploy to apply.
n8n can still reject a write; this preview covers what reads can show.
```

## Status

Early stage, best-effort support. Multi-environment support (dev, staging, prod) and drift detection are on the roadmap.

> n8nlift is an independent open source project. It is not affiliated with, endorsed by, or sponsored by n8n GmbH.

## Development

```sh
npm install
npm run verify   # lint, typecheck, tests
npm run build    # compile into dist/
```

`npm start` builds, then runs `debug/main.ts` against `dist/` as an external consumer would. With no argument it runs a real `n8nlift deploy` of `debug/workflows` to the instance in `debug/.env`: point that file at a test instance.

## License

[MIT](LICENSE)
