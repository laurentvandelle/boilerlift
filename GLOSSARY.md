# Boilerlift

Boilerlift is a command-line tool that keeps n8n workflows as typed files in Git and tests them like any other code.
It deploys them to the user's own n8n instance as drafts, and the published version keeps running until the user publishes.

## Terms

### The instance

- **Instance**: the user's own n8n server, reached at the `url` of a target and through its public API with the target's API key. Boilerlift never hosts one.
- **Project config**: `boilerlift.config.ts` at the project root, committed with it: the default export of `defineConfig`, which declares the targets. Every command that talks to n8n requires it. It reads its secrets from `process.env`, which Boilerlift fills from `./.env` first. _Avoid_: `.env`, which only holds variables.
- **Target**: one named entry of the project config: an instance `url`, its API key (`apiKey`, read from an environment variable the user names), and the folder of workflow files it receives (`workflows`). `ping` and `deploy` run on one target, or on every one with `--all`, in declaration order. Several targets may share an instance or a folder. _Avoid_: environment, which is the process environment the config reads its values from.
- **Instance connection**: the link from Boilerlift to the instance, that `ping` checks. _Avoid_: connection, which is a link between two nodes.

### Workflows

- **Workflow file**: one workflow in the workflows folder of a target: a `.workflow.ts` file whose default export is an n8n export passed to `defineWorkflow`, or a `.json` n8n export. Its base name is its stable name.
- **Local workflow**: a workflow file that passed every check, ready to deploy: its stable name, path, name, nodes, connections and settings.
- **Node**: one step of an n8n workflow, as the export lists it under `nodes`. _Avoid_: node for the runtime; write Node.js.
- **Connection**: a link from the output of one node to another node, as the export lists it under `connections`. _Avoid_: connection for the instance connection.
- **Stable name**: the name of a workflow across runs and instances: the file base name without `.workflow.ts` / `.json`, 1 to 64 of `a-z`, `0-9` and `-`.
- **Lock file**: `boilerlift.lock.json` at the project root, committed with it: for each instance (the cleaned-up `url` of a target), the n8n id of each stable name that `deploy` created there. `deploy` finds its workflows by these ids only. _Avoid_: stable tag, the identity before ADR 0009.

### Versions on the instance

- **Draft**: the latest saved version of a workflow on the instance. `deploy` writes only drafts.
- **Published**: the version of a workflow that runs on its triggers. It changes only when the user publishes. _Avoid_: live.
- **Archived**: a workflow deleted in the n8n editor. It stays on the instance, with its id, until it is unarchived. A workflow that is not archived is unarchived. _Avoid_: deleted, live.
- **Restored**: an archived workflow that `deploy` unarchived and brought back as an unpublished draft.

### Deploy

- **Deploy**: delivering every local workflow of a target to its instance: create the new ones, update the changed ones as drafts, restore the archived ones, skip the unchanged ones, and record the id of each one it creates in the lock file.
- **Plan**: what a deploy would do, worked out from reads only: one action per local workflow, the warnings, and the blocker if one stopped it. A dry run shows the plan; a real deploy applies it.
- **Action**: what deploy does with one local workflow: `created`, `recreated` (its recorded id answers 404, so it is created again from code), `updated`, `skipped`, `restored`, `failed` or `not-processed` (a blocker stopped the run first).
- **Blocker**: a failure that stops the whole run: the instance cannot be reached, it rejects the API key, it cannot save drafts, or the lock file cannot be written after a create. A failure on one workflow is not a blocker. _Avoid_: fatal, stop.
- **Dry run**: `deploy --dry-run` computes deploy's plan and writes nothing.
