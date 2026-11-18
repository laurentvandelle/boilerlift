# Boilerlift

**Code is the source. n8n is the runtime.**

Write n8n workflows in TypeScript, test them like any other code, and lift them from dev to prod.

Boilerlift is a command-line tool for people who want their n8n workflows to live in Git, not only in the editor. You paste an n8n export into a typed `.workflow.ts` file, let the editor catch a broken shape, run unit tests, then deploy to your n8n instance. Updates land as drafts, so the published version keeps running until you choose to publish.

## Why Boilerlift

- **Typed workflow files.** Paste an n8n export into `defineWorkflow`: the editor flags a missing node field, a connection to a node that does not exist, or a node name used twice, before anything is deployed.
- **Tested before shipped.** Workflows are plain TypeScript: lint, typecheck and test them in CI.
- **Safe delivery.** Deploy as draft, review, then publish. Requires n8n 2.35.0 or later.
- **Built for AI coding agents.** Agents edit code and run the CLI instead of calling the n8n API directly.
- **Your instance, your rules.** Boilerlift talks to your own n8n instance through its public API. Nothing is hosted for you.

## Install

```sh
npm install -g boilerlift
```

This installs the `lift` command. `boilerlift` is an alias of `lift`, for a shell where `lift` is already taken.

Requires Node.js 22.18 or later, and n8n 2.35.0 or later.

In a project whose workflows are `.workflow.ts` files, also install it as a dev dependency, so the files can import `defineWorkflow`:

```sh
npm install --save-dev boilerlift
```

## Quick start

```sh
lift --help            # list the available commands
lift ping              # check the connection to your n8n instance
lift deploy            # deliver the workflows of your target as drafts
lift deploy -t prod    # deliver to the target named prod
lift deploy --all      # deliver to every target, one after the other
lift deploy --dry-run  # show what deploy would do, write nothing
lift help <command>    # show the options of one command
lift --version         # print the installed version
```

## Declare your targets

A **target** is one n8n instance Boilerlift deploys to, with the folder of workflow files it receives. Declare your targets in **`boilerlift.config.ts`** at the project root. Every command that talks to n8n reads it; without it, the command stops, exits 1 and prints a starter config to copy.

```ts
// boilerlift.config.ts
import { defineConfig } from 'boilerlift';

export default defineConfig({
  targets: {
    dev: {
      url: 'https://dev.your-n8n.example.com',
      apiKeyEnv: 'N8N_DEV_API_KEY',
      workflows: './workflows',
    },
    prod: {
      url: 'https://your-n8n.example.com',
      apiKeyEnv: 'N8N_PROD_API_KEY',
      workflows: './workflows',
    },
  },
});
```

| Field       | Value                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| key         | The target name: 1 to 64 lowercase letters, digits or dashes. Targets are listed and run in the order you declare them.        |
| `url`       | Root URL of the n8n instance, `http://` or `https://`. Boilerlift adds `/api/v1` itself.                                     |
| `apiKeyEnv` | The name of the environment variable that holds the n8n API key (n8n → Settings → n8n API). The key itself is never in the file. |
| `workflows` | The folder of the workflow files for this target, from the project root. Always explicit.                                     |

The API key is read from the environment, then from a `.env` file in the current folder. A variable set in the environment wins over `.env`.

```sh
# .env — keep it out of Git
N8N_DEV_API_KEY=your-dev-api-key
N8N_PROD_API_KEY=your-prod-api-key
```

With one target declared, `ping` and `deploy` run on it. With several, name one with `--target <name>` (`-t`), or run on every one in turn with `--all`. Several targets and none named, an unknown name, or a target whose workflows folder does not exist stops the command before anything is sent, lists the available targets and exits 1. `--target` and `--all` together are a usage error.

Several targets may share a workflows folder (the same files to dev and prod), or share an instance with different folders. Two targets on the same instance whose folders hold the same stable name would overwrite each other's workflow: `deploy` refuses this before writing, naming both targets and the file.

> Upgrading from `N8N_URL`: Boilerlift no longer reads `N8N_URL`. Paste the starter config `lift ping` prints, set its `url`, and keep `N8N_API_KEY` in `.env`.

## Check your connection

Before deploying anything, check that your project can reach the instance of your target. `lift ping` reads the target from `boilerlift.config.ts` and its API key from the environment or `.env`.

Add the script to your project's `package.json`, then run `npm run ping`:

```json
{
  "scripts": {
    "ping": "lift ping"
  }
}
```

`ping` is read-only. It checks, in order, that Node.js is 22.18 or later, that the instance answers on `GET /healthz`, and that the public API accepts your key (`GET /api/v1/workflows`). After a failed check the next ones are skipped, and each failure prints the next step. The key is never printed. An `http://` URL gets a warning, because the key travels unencrypted. `--json` prints the checks as JSON. With `--all`, each target gets its own block, then a recap line per target, and the exit code is the highest of them.

| Exit code | Meaning                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Every check passed                                                                                                                                |
| 1         | Usage error, missing or invalid `boilerlift.config.ts`, an unknown target, a missing API key, or an unexpected error (printed with its stack) |
| 2         | Node.js is older than 22.18                                                                                                                       |
| 3         | The instance or its public API cannot be reached                                                                                                  |
| 4         | The API key is rejected                                                                                                                           |

> Requires n8n 2.35.0 or later. `ping` cannot check this: the n8n API doesn't expose its version. `deploy` checks it before writing anything, from the API spec the instance serves.

## Write a workflow

Export a workflow from n8n (editor → ⋯ → Download), then paste the JSON into `defineWorkflow` in a `.workflow.ts` file under the workflows folder of your target (`./workflows` below):

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

`defineWorkflow` returns the export unchanged. Your editor (TypeScript 5.4 or later) flags:

- a node missing `name`, `type`, `typeVersion`, `position` (two numbers) or `parameters`;
- a connection from or to a node name that is not in `nodes`;
- a node name used twice.

Other keys of the export (`id`, `meta`, `pinData`, `versionId`, `credentials`…) are accepted as they are. `Workflow`, `WorkflowNode` and `WorkflowConnection` are exported for your own code.

## Deploy

`lift deploy` delivers every workflow in the workflows folder of the target to its instance. It reads the targets like `ping`. With `--all`, every target is checked first (config, API key, folder): if one is broken, nothing is written. Then each target is deployed in turn; a failed target does not stop the next ones, and the exit code is the highest of them.

```text
workflows/
  invoice-sync.workflow.ts   # export default <workflow pasted from an n8n export>
  crm/crm-import.json        # a workflow exported from n8n
```

Before anything is sent, `deploy` checks every file, `.workflow.ts` and `.json` alike, with the same rules as the editor: the workflow has a `name`, `nodes` and `connections`; every node has `name`, `type`, `typeVersion`, `position` and `parameters`; node names are unique; every connection goes from and to an existing node. One wrong file refuses the whole run, names the file and what is wrong, and exits 1.

The file name without `.workflow.ts` / `.json` is the workflow's **stable name**: 1 to 64 lowercase letters, digits or dashes, unique across all folders.

When `deploy` creates a workflow, it records its n8n id in **`boilerlift.lock.json`** at the project root, under the instance (the `url` of the target) and the stable name:

```json
{
  "version": 1,
  "instances": {
    "https://your-n8n.example.com": {
      "crm-import": { "n8nId": "7Hq2" }
    }
  }
}
```

`deploy` finds your workflows by these ids only, never by name or tag. Renaming the workflow in n8n keeps the link (the name in the file wins on the next update); renaming the file makes a new workflow. A workflow on the instance that the lock file does not list is never touched, so several projects can share one instance. **Commit `boilerlift.lock.json`** after each deploy that changes it (the report then says `boilerlift.lock.json updated — commit it`): a deploy from another machine or from CI without it would create the workflows again.

```text
lift deploy → prod (https://your-n8n.example.com)
~ updated        crm-import     workflows/crm/crm-import.json (draft; published version still running)
= skipped        daily-report   unchanged
+ created        invoice-sync   workflows/invoice-sync.workflow.ts
! restored       lead-scoring   workflows/lead-scoring.json (unpublished draft)
⚠ lead-scoring: workflow 7Hq2 was archived in n8n; it is back as an unpublished draft
1 created, 1 updated, 1 restored, 1 skipped, 0 failed. Drafts are not live until you publish them.
boilerlift.lock.json updated — commit it
```

- Before any write, `deploy` reads the instance's API spec (`GET /api/v1/openapi.yml`). If the instance cannot save drafts (older than n8n 2.35.0), it stops, changes nothing and exits 6.
- New workflows are created and never published, and their ids recorded in `boilerlift.lock.json`. Updates, skips, restores and dry runs never write it.
- Changed workflows are updated as drafts: the published version keeps running until you publish in n8n.
- Workflows whose current draft already matches the file are skipped, so a rerun changes nothing.
- A workflow deleted in the n8n editor is only archived. `deploy` unarchives it and updates it as a draft (`restored`), with a warning: it stays unpublished until you publish it. This needs the `workflow:delete` scope on the API key. The lock file keeps its id.
- A recorded workflow that n8n no longer has (deleted for good, so its id answers 404) is created again from code (`* recreated`), and its new id replaces the old one in the lock file.
- A failure on one workflow marks it `✗ failed`, with the failed call and the next step below its line, and the others are still delivered.
- An unreachable instance or a rejected key stops the run: the workflows not yet processed are listed as `not-processed`.
- If `boilerlift.lock.json` cannot be written after a create, the run stops (exit 7): the error names the created id, and the hint says what to add to the file by hand. An invalid `boilerlift.lock.json` stops `deploy` before any call (exit 1).
- Workflows tagged `boilerlift:<stable-name>` by earlier versions are not taken over: with no record, `deploy` creates them again. Their tags stay; delete or archive the old copies in the n8n editor.
- After the summary, stderr recaps the failed and not-processed workflows and the next step.
- `--json` prints the same report as JSON, for scripts and AI agents: each result has an `action` (`created`, `recreated`, `updated`, `skipped`, `restored`, `failed`, `not-processed`), a `previousId` when it was recreated and, when it failed, an `error` with `call`, `detail` and `hint`; plus `target`, `instance`, `dryRun` (`true` under `--dry-run`), `summary`, `warnings`, `lockFile` (`{ path, changed }`), `exitCode`, and a top-level `error` only when the whole run stopped. With `--all`, the report is `{ "targets": [{ "target": "dev", … }, …], "exitCode": … }`. A config error prints `{ "error", "availableTargets", "exitCode" }`.

| Exit code | Meaning                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0         | Every workflow delivered, or nothing to deploy                                                                         |
| 1         | Usage error, missing or invalid configuration, targets sharing a workflow on one instance, invalid workflow files, or an unexpected error (printed with its stack) |
| 3         | The instance cannot be reached, or does not answer like the n8n public API                                             |
| 4         | The API key is rejected                                                                                                |
| 5         | At least one workflow failed; the others were delivered                                                                |
| 6         | The instance is older than n8n 2.35.0: nothing was written                                                             |
| 7         | A workflow was created but `boilerlift.lock.json` could not be written: the run stopped there                          |

### Dry run

`lift deploy --dry-run` reads the instance and shows what `deploy` would do, without writing anything: each workflow is listed as `would create`, `would recreate`, `would update`, `would restore`, `would skip` or `would fail`, and blockers (unreachable instance, rejected key, n8n older than 2.35.0) show as they would on a real deploy. The exit codes are the same. A real deploy does the same reads first, so the preview is what it would do right after.

```text
lift deploy --dry-run → prod (https://your-n8n.example.com)
~ would update   crm-import     workflows/crm/crm-import.json (draft; published version still running)
= would skip     daily-report   unchanged
+ would create   invoice-sync   workflows/invoice-sync.workflow.ts
Would: 1 create, 1 update, 0 restore, 1 skip, 0 fail.
Dry run: nothing was written. Run lift deploy to apply.
n8n can still reject a write; this preview covers what reads can show.
boilerlift.lock.json would update — commit it after lift deploy
```

## Status

Early stage, best-effort support. Promoting workflows between targets and drift detection are on the roadmap.

> Boilerlift is an independent open source project. It is not affiliated with, endorsed by, or sponsored by n8n GmbH.

## Development

```sh
npm install
npm run verify   # lint, typecheck, tests
npm run build    # compile into dist/
```

`npm start` builds, then runs `debug/main.ts` against `dist/` as an external consumer would. With no argument it runs a real `lift deploy` of `debug/workflows` to the target in `debug/boilerlift.config.ts`, with the API key in `debug/.env`: point them at a test instance.

## License

[MIT](LICENSE)
