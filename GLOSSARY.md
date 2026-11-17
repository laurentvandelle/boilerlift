# Boilerlift

Boilerlift is a command-line tool that keeps n8n workflows as typed files in Git and tests them like any other code.
It deploys them to the user's own n8n instance as drafts, and the published version keeps running until the user publishes.

## Terms

### The instance

- **Instance**: the user's own n8n server, reached through `N8N_URL` and its public API with `N8N_API_KEY`. Boilerlift never hosts one.
- **Instance connection**: the link from Boilerlift to the instance, that `ping` checks. _Avoid_: connection, which is a link between two nodes.

### Workflows

- **Workflow file**: one workflow under `./workflows`: a `.workflow.ts` file whose default export is an n8n export passed to `defineWorkflow`, or a `.json` n8n export. Its base name is its stable name.
- **Local workflow**: a workflow file that passed every check, ready to deploy: its stable name, path, name, nodes, connections and settings.
- **Node**: one step of an n8n workflow, as the export lists it under `nodes`. _Avoid_: node for the runtime; write Node.js.
- **Connection**: a link from the output of one node to another node, as the export lists it under `connections`. _Avoid_: connection for the instance connection.
- **Stable name**: the identity of a workflow across runs and instances: the file base name without `.workflow.ts` / `.json`, 1 to 16 of `a-z`, `0-9` and `-`.
- **Stable tag**: the tag `boilerlift:<stable-name>` that a workflow carries on the instance, by which `deploy` finds it again.

### Versions on the instance

- **Draft**: the latest saved version of a workflow on the instance. `deploy` writes only drafts.
- **Published**: the version of a workflow that runs on its triggers. It changes only when the user publishes. _Avoid_: live.
- **Archived**: a workflow deleted in the n8n editor. It stays on the instance, with its id and its tags, until it is unarchived. A workflow that is not archived is unarchived. _Avoid_: deleted, live.
- **Restored**: an archived workflow that `deploy` unarchived and brought back as an unpublished draft.

### Deploy

- **Deploy**: delivering every local workflow to the instance: create the new ones, update the changed ones as drafts, restore the archived ones, skip the unchanged ones.
- **Plan**: what a deploy would do, worked out from reads only: one action per local workflow, the warnings, and the blocker if one stopped it. A dry run shows the plan; a real deploy applies it.
- **Action**: what deploy does with one local workflow: `created`, `updated`, `skipped`, `restored`, `failed` or `not-processed` (a blocker stopped the run first).
- **Blocker**: a failure that stops the whole run: the instance cannot be reached, it rejects the API key, or it cannot save drafts. A failure on one workflow is not a blocker. _Avoid_: fatal, stop.
- **Dry run**: `deploy --dry-run` computes deploy's plan and writes nothing.
