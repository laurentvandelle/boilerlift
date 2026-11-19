# `lift deploy`

Delivers every workflow in the workflows folder of the target to its n8n instance, as drafts: the published version keeps running until you publish in n8n.

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

## What each workflow becomes

An example report:

```text
lift deploy → prod (https://your-n8n.example.com)
~ updated        crm-import     workflows/crm/crm-import.json (draft; published version still running)
= skipped        daily-report   unchanged
+ created        invoice-sync   workflows/invoice-sync.workflow.ts
! restored       lead-scoring   workflows/lead-scoring.json (unpublished draft)
⚠ lead-scoring: workflow 7Hq2 was archived in n8n; it is back as an unpublished draft
1 created, 1 updated, 1 restored, 1 skipped, 0 failed. Drafts are not live until you publish them.
Tag prod added to 4 workflows
boilerlift.lock.json updated — commit it
```

- New workflows are created and never published, and their ids recorded in `boilerlift.lock.json`.
- Changed workflows are updated as drafts: the published version keeps running until you publish in n8n.
- Workflows whose current draft already matches the file are skipped, so a rerun changes nothing.
- A workflow deleted in the n8n editor is only archived. `deploy` unarchives it and updates it as a draft (`restored`), with a warning: it stays unpublished until you publish it. This needs the `workflow:delete` scope on the API key.
- A recorded workflow that n8n no longer has (deleted for good, so its id answers 404) is created again (`* recreated`), and its new id replaces the old one in the lock file.
- A failure on one workflow marks it `✗ failed`, with the failed call and the next step below its line, and the others are still delivered.
- An unreachable instance or a rejected key stops the run: the workflows not yet processed are listed as `not-processed`.
- After the summary, stderr recaps the failed and not-processed workflows and the next step.

## The target tag

Unless the target sets `tag: false` in `boilerlift.config.ts`, `deploy` makes sure every workflow it delivers carries a tag named after the target (`prod` above), so people working in n8n can see which target a workflow belongs to. Skipped workflows get it too, so workflows deployed by an earlier version are tagged on the next run.

- The tag is found on the instance by name, and created the first time.
- The workflow's other tags are kept. A workflow that already has the tag gets no tag write, and the summary line `Tag prod added to 4 workflows` shows only when at least one workflow received it.
- The tag never changes an action: a skipped workflow stays `skipped`.
- If the tag cannot be created or added, for example when the API key has no rights on tags, a warning names the workflow and the error. The workflow still counts as deployed, the lock file is still written, and the exit code does not change.
- With `tag: false`, deploy makes no tag call. Turning it off does not remove the tag from workflows already tagged.
- The tag is for display only: deploy never uses it, or any tag, to find your workflows ([ADR 0014](../adr/0014-display-only-target-tag.md)).

With `--json`, the report carries `"tag": { "name": "prod", "added": 4 }`, or `"tag": null` when the target turns it off.

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

**Commit `boilerlift.lock.json`** after each deploy that changes it (the report then says `boilerlift.lock.json updated — commit it`): a deploy from another machine or from CI without it would create the workflows again.

- Updates, skips, restores and dry runs never write it.
- If it cannot be written after a create, the run stops (exit 7): the error names the created id, and the hint says what to add to the file by hand.
- An invalid `boilerlift.lock.json` stops `deploy` before any call (exit 1).
- Workflows tagged `boilerlift:<stable-name>` by earlier versions are not taken over: with no record, `deploy` creates them again. Their tags stay; delete or archive the old copies in the n8n editor.

Why ids and not names: [ADR 0009](../adr/0009-lock-file-identity.md).

## Dry run

`lift deploy --dry-run` reads the instance and shows what `deploy` would do, without writing anything: each workflow is listed as `would create`, `would recreate`, `would update`, `would restore`, `would skip` or `would fail`, and blockers (unreachable instance, rejected key, n8n too old) show as they would on a real deploy. The exit codes are the same. A real deploy does the same reads first, so the preview is what it would do right after.

```text
lift deploy --dry-run → prod (https://your-n8n.example.com)
~ would update   crm-import     workflows/crm/crm-import.json (draft; published version still running)
= would skip     daily-report   unchanged
+ would create   invoice-sync   workflows/invoice-sync.workflow.ts
Would: 1 create, 1 update, 0 restore, 1 skip, 0 fail.
Tag prod would be added to 3 workflows
Dry run: nothing was written. Run lift deploy to apply.
n8n can still reject a write; this preview covers what reads can show.
boilerlift.lock.json would update — commit it after lift deploy
```

With `--json`, the report carries `"dryRun": true`.
