# `lift deploy`

Delivers every workflow in the workflows folder of the target to its n8n instance, as drafts: the published version keeps running until you publish with [`lift publish`](publish.md).

```sh
lift deploy            # the only target, or the one named with -t
lift deploy -t prod    # the target named prod
lift deploy --all      # every target, one after the other
lift deploy --dry-run  # show what deploy would do, write nothing
lift deploy --json     # the report as JSON, for scripts and AI agents
```

`lift help deploy` prints every option and the exit codes. The targets come from `boilerlift.config.ts` (see [Configure your targets](../configuration.md)). With `--all`, every target is checked first (config, API key, folder): if one is broken, nothing is written. Then each target is deployed in turn; a failed target does not stop the next ones, and the exit code is the highest of them.

## Before anything is sent

```text
workflows/
  invoice-sync.workflow.ts   # export default <workflow pasted from an n8n export>
  crm/crm-import.json        # a workflow exported from n8n
```

`deploy` checks every file, `.workflow.ts` and `.json` alike, with the same rules as the editor (see [Write a workflow](../workflows.md)): the workflow has a `name`, `nodes` and `connections`; every node has `name`, `type`, `typeVersion`, `position` and `parameters`; node names are unique; every connection goes from and to an existing node. One wrong file refuses the whole run, names the file and what is wrong, and exits 1.

Then it reads the instance's API spec (`GET /api/v1/openapi.yml`). If the instance cannot save drafts (older than the `MIN_N8N_VERSION` of [`src/core/n8n/n8n-api.ts`](../../src/core/n8n/n8n-api.ts)), it stops, changes nothing and exits 6.

## Credentials

A node that picks a credential with `credential('key')` (see [`lift creds sync`](creds.md)) is sent with the n8n `{ id, name }` of that key in `credentials/<target>.ts`, the list of the target being deployed, under the type that list gives it. The same workflow file therefore deploys to `dev` with the dev credential and to `prod` with the prod one.

Before writing anything to a target, `deploy` lists the credentials of its instance once (`GET /api/v1/credentials`, every page) and checks each key its workflows use. A credential is **missing** on the target when:

- its key is not in `credentials/<target>.ts`,
- or the instance no longer has its id,
- or the instance has its id under another type.

A credential renamed in n8n keeps its id, so it still resolves, under its current name. A missing credential stops that target before any write, and exits 8:

```text
lift deploy · prod (https://your-n8n.example.com)

✗ GET /api/v1/credentials : 2 credentials missing on target prod: gmail-sales, slack
  gmail-sales (gmailOAuth2)  not in credentials/prod.ts; used by crm-import, invoice-sync
  slack (slackApi)  id 7Fk2 in credentials/prod.ts, gone from the instance; used by daily-report
  → Run lift creds sync --target prod to update credentials/prod.ts, or create the missing credentials in n8n first, then run deploy again

Nothing was written to n8n.
```

With `--json`, the `error` carries `"kind": "credentials-missing"` and a `missing` array: each `key`, its `type` (`null` when no list ever held it), its `reason` (`not-listed`, `gone` or `type-changed`), the `id` the list gives it (`null` when not listed) and the `workflows` that use it. A dry run reports the same.

- With `--all`, a missing credential stops only the target that lacks it; the other targets still deploy.
- When workflows use `credential()` and the API key lacks the `credential:list` scope (n8n answers 403), the target stops before any write and exits 9. Give the key that scope in n8n → Settings → n8n API. Workflows that use no `credential()` deploy without this call.
- A credential recreated in n8n under the same name gets a new id: after `lift creds sync`, `deploy` updates the workflows that use it.
- Only the key, name, type and id of a credential are read, never a secret.

## What each workflow becomes

An example report:

```text
lift deploy · prod (https://your-n8n.example.com)

~ crm-import    updated  https://your-n8n.example.com/workflow/3Kd9 (draft; published version still running)
= daily-report  skipped  unchanged  https://your-n8n.example.com/workflow/9fPz
+ invoice-sync  created  https://your-n8n.example.com/workflow/Qa71
↺ lead-scoring  restored  https://your-n8n.example.com/workflow/7Hq2 (unpublished draft)
! lead-scoring: workflow 7Hq2 was archived in n8n; it is back as an unpublished draft

1 created, 1 updated, 1 restored, 1 skipped, 0 failed.
Tag boilerlift:prod added to 4 workflows

→ lift publish  publishes the drafts
→ commit boilerlift.lock.json  it was updated
```

- New workflows are created and never published, and their ids recorded in `boilerlift.lock.json`.
- Changed workflows are updated as drafts: the published version keeps running until you run `lift publish`.
- Workflows whose current draft already matches the file are skipped, so a rerun changes nothing.
- A workflow deleted in the n8n editor is only archived. `deploy` unarchives it and updates it as a draft (`restored`), with a warning: it stays unpublished until you publish it. This needs the `workflow:delete` scope on the API key.
- A recorded workflow that n8n no longer has (deleted for good, so its id answers 404) is created again (`* recreated`), and its new id replaces the old one in the lock file.
- A failure on one workflow marks it `✗ … failed`, with the failed call and the next step below its name, and the others are still delivered.
- An unreachable instance or a rejected key stops the run: the workflows not yet processed are listed as `– … not processed`.
- After the summary, stderr recaps the failed and not-processed workflows and the next step.

## The target tag

Unless the target sets `tag: false` in `boilerlift.config.ts`, `deploy` makes sure every workflow it delivers carries the tag `boilerlift:<target>` (`boilerlift:prod` above), so people working in n8n can see which target a workflow belongs to. Skipped workflows get it too, so workflows deployed by an earlier version are tagged on the next run.

- The tag is found on the instance by name, and created the first time.
- The workflow's other tags are kept. A workflow that already has the tag gets no tag write, and the summary line `Tag boilerlift:prod added to 4 workflows` shows only when at least one workflow received it.
- The tag never changes an action: a skipped workflow stays `skipped`.
- If the tag cannot be created or added, for example when the API key has no rights on tags, a warning names the workflow and the error. The workflow still counts as deployed, the lock file is still written, and the exit code does not change.
- With `tag: false`, deploy makes no tag call. Turning it off does not remove the tag from workflows already tagged.
- The tag is for display only: deploy never uses it, or any tag, to find your workflows ([ADR 0014](../adr/0014-display-only-target-tag.md)).

With `--json`, the report carries `"tag": { "name": "boilerlift:prod", "added": 4 }`, or `"tag": null` when the target turns it off.

The actions and the JSON report are typed in [`src/core/deliver/deploy.model.ts`](../../src/core/deliver/deploy.model.ts).

## The lock file

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

`deploy` finds your workflows by these ids only, never by name or tag. Renaming the workflow in n8n keeps the link (the name in the file wins on the next update); renaming the file makes a new workflow. A workflow on the instance that the lock file does not list is never touched, so several projects can share one instance.

**Commit `boilerlift.lock.json`** after each deploy that changes it (the report then ends with `→ commit boilerlift.lock.json  it was updated`): a deploy from another machine or from CI without it would create the workflows again.

- Updates, skips, restores and dry runs never write it.
- If it cannot be written after a create, the run stops (exit 7): the error names the created id, and the hint says what to add to the file by hand.
- An invalid `boilerlift.lock.json` stops `deploy` before any call (exit 1).
- Workflows tagged `boilerlift:<stable-name>` by earlier versions are not taken over: with no record, `deploy` creates them again. Their tags stay; delete or archive the old copies in the n8n editor.

Each workflow that exists on the instance shows its workflow link, `<target url>/workflow/<id>`, in place of its file path, so a click opens it in the n8n editor. A failed or not processed workflow keeps its file path. With `--json`, each result carries the same link as `url`, or `null` when its line has none.

Why ids and not names: [ADR 0009](../adr/0009-lock-file-identity.md).

## Dry run

`lift deploy --dry-run` reads the instance and shows what `deploy` would do, without writing anything: each workflow is listed as `would create`, `would recreate`, `would update`, `would restore`, `would skip` or `would fail`, and blockers (unreachable instance, rejected key, n8n too old, missing credentials) show as they would on a real deploy. The exit codes are the same. A real deploy does the same reads first, so the preview is what it would do right after.

```text
lift deploy --dry-run · prod (https://your-n8n.example.com)

~ crm-import    would update  https://your-n8n.example.com/workflow/3Kd9 (draft; published version still running)
= daily-report  would skip  unchanged  https://your-n8n.example.com/workflow/9fPz
+ invoice-sync  would create  workflows/invoice-sync.workflow.ts

Would: 1 create, 1 update, 0 restore, 1 skip, 0 fail.
Tag boilerlift:prod would be added to 3 workflows
Dry run: nothing was written.
n8n can still reject a write; this preview covers what reads can show.

→ lift deploy  applies it
→ commit boilerlift.lock.json after lift deploy  it would update
```

A workflow that would be created or recreated has no id yet, so it shows its file path. With `--json`, the report carries `"dryRun": true`.
