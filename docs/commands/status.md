# `lift status`

Shows, for each workflow of the target, where it stands on its n8n instance and the next step. It only reads: nothing changes on the instance or in `boilerlift.lock.json`.

```sh
lift status                  # the only target, or the one named with -t
lift status -t prod          # the target named prod
lift status --all            # every target, one after the other
lift status --managed=true   # only the workflows of the project
lift status --managed=false  # only the workflows that are not in the project
lift status --archived       # also the archived workflows that are not in the project
lift status --json           # each workflow with its state and next command, for scripts and AI agents
```

`lift help status` prints every option and the exit codes. The targets come from `boilerlift.config.ts` (see [Configure your targets](../configuration.md)).

## States

A workflow of the project (a workflow file of the target) gets the first state that holds, in this order:

| State (`--json`) | Shown as | Next step |
| --- | --- | --- |
| `missing` | missing on the instance: `boilerlift.lock.json` records no id for it, or n8n no longer has that id (404) | `lift deploy` |
| `archived` | archived in n8n — next deploy restores it | `lift deploy` |
| `differs` | differs from n8n — next deploy overwrites the n8n draft | `lift deploy` |
| `draft-pending` | draft not yet published: the n8n draft holds the local file, but it is not the published version, or nothing is published | `lift publish <name>` |
| `up-to-date` | up to date: the published version holds the local file | none |

`differs` compares the local file with the current n8n draft the way `deploy` does, so it covers both a change in the file and a change in the n8n editor: nothing records which side changed.

Every other workflow of the instance, one that `boilerlift.lock.json` does not record for this target, is `unmanaged` (not in my project). Status never changes it. Archived ones are listed only with `--archived`. Your workflows are found by the ids of `boilerlift.lock.json` only, never by name or tag.

With a target named (`-t`) or `--all`, each next command carries `--target <name>`.

```text
lift status → dev (https://n8n.example.com)
~ crm-import    differs from n8n — next deploy overwrites the n8n draft
  → lift deploy
^ daily-report  draft not yet published
  → lift publish daily-report
+ invoice-sync  missing on the instance (workflows/invoice-sync.workflow.ts)
  → lift deploy
· Hand made     not in my project (h1)
1 missing, 0 archived, 1 differ, 1 draft not yet published, 0 up to date, 1 not in my project.
```

A target with no workflow file shows `No workflow yet in <folder>. Add a workflow file there, then run lift deploy.`, still lists the workflows of the instance, and exits 0.

## Exit codes

Status exits 0 whenever it read everything, whatever the states. It exits 1 on a usage error, an invalid `boilerlift.config.ts`, `boilerlift.lock.json` or workflow file; 3 when the instance cannot be reached or a read fails; 4 when the API key is rejected. On 3 and 4 it tells you to run `lift ping`.

## Calls

`GET /api/v1/workflows/{id}` for each workflow `boilerlift.lock.json` records, then every page of `GET /api/v1/workflows` for the others (skipped with `--managed=true`). The draft and published versions come from the `versionId` and `activeVersionId` fields of n8n.
