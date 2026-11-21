# `lift reset`

Removes, on the n8n instance of one target, every workflow Boilerlift recorded as deployed there, then drops their entries from `boilerlift.lock.json`. Use it to leave a test server clean, or to undo a deploy to the wrong environment. It archives by default; with `--delete`, it deletes them for good instead. Nothing changes until you type the target name.

```sh
lift reset --target dev               # list, then ask for the target name before archiving
lift reset --target dev --dry-run     # list what reset would archive; change nothing
lift reset --target dev --delete      # delete them for good instead: cannot be undone
lift reset --target dev --yes         # or -y, -f, --force: no question
lift reset --target dev --json --yes  # the result as JSON, for scripts and AI agents
```

`--target` is required, even when `boilerlift.config.ts` declares a single target, and `--all` is refused: both exit 1. `lift help reset` prints every option and the exit codes. The targets come from `boilerlift.config.ts` (see [Configure your targets](../configuration.md)).

## Which workflows

`boilerlift.lock.json` records workflows by instance, not by target. Reset removes, among the entries recorded for the instance of the target:

| Entry | What reset does |
| --- | --- |
| its stable name has a file in the target's folder | removes it |
| its stable name has no file in the folder of any target on the instance (a removed workflow) | removes it |
| its stable name has a file in the folder of another target on the same instance | keeps it, even when the target's folder has the file too |

For each other target on the instance, reset prints `<n> workflows of target <other> kept`. Every folder of every target on the instance must exist: reset exits 1 otherwise. See [ADR 0018](../adr/0018-reset-scope-on-a-shared-instance.md).

Your workflows are found by the ids of `boilerlift.lock.json` only, never by name or tag. Reset never touches a workflow Boilerlift never deployed, the credentials, the project's workflow files, or the `boilerlift:<target>` tag. A workflow already archived in n8n, or whose id n8n no longer knows (404), has nothing to archive: reset only drops its entry.

After a reset, `lift status` shows the project's workflows as not deployed yet, and `lift deploy` deploys them again.

## Confirmation

In a terminal, reset lists the workflows on stderr, then asks for the target name:

```text
lift reset → dev (https://n8n.example.com)
  - crm-import  CRM import (crm1): will be archived
  - old-report  Old report (old1): already archived in n8n: its entry will be dropped from boilerlift.lock.json
1 workflows of target staging kept
Reset dev? The 2 workflows are archived in n8n and dropped from boilerlift.lock.json.
Type the target name (dev) to confirm:
```

The answer is trimmed and must be the target name exactly, case-sensitive. Any other answer, or a closed stdin, prints `Nothing archived.` and exits 0. `-y`, `--yes`, `-f` and `--force` skip the question. When nothing matches the target, reset prints `Nothing to remove on dev.`, asks nothing and exits 0.

Without a terminal (stdin is not a TTY), or with `--json`, reset never asks. Unless `--yes` or `--force` is given, it lists the workflows, changes nothing, and exits 11, with `lift reset --target dev --yes` as the next step. `--dry-run` prints the same listing, ends with `Dry run: nothing was archived.`, asks nothing and exits 0.

## Result

```text
lift reset → dev (https://n8n.example.com)
- archived         crm-import  CRM import (crm1)
= already archived old-report  Old report (old1), entry dropped from boilerlift.lock.json
1 archived, 1 already archived, 0 not found, 0 failed.
boilerlift.lock.json updated — commit it.
1 workflows of target staging kept
```

A workflow n8n refuses to archive (a key without the `workflow:delete` scope answers 403, or a network error) fails on its own: it keeps its entry, the step to take is printed under it, the others are still removed, and the run exits 5. Run `lift reset --target dev` again once it is fixed.

## Delete for good

`lift reset --target dev --delete` deletes the workflows for good, as `lift clean --delete` does: each one not archived yet is archived first, then deleted, so a failed delete leaves it archived and keeps its entry. The question says the deletion is permanent:

```text
Reset dev? The 2 workflows are deleted for good: this cannot be undone.
Type the target name (dev) to confirm:
```

Any other answer prints `Nothing deleted.`.

## Exit codes

0 when every workflow was removed, nothing matched the target, on a dry run, or when the typed name was not the target's. 1 on a usage error (no `--target`, or `--all`), an invalid `boilerlift.config.ts` or `boilerlift.lock.json`, or a missing workflows folder. 3 when the instance cannot be reached or a read fails, 4 when the API key is rejected: nothing was removed. 5 when at least one workflow was not removed; the others were. 11 when there are workflows to remove but reset could not ask (no terminal, or `--json`) and neither `--yes` nor `--force` was given: nothing changed.

## JSON

The payload carries its `stage`: `nothing-to-remove`, `dry-run` or `confirmation-needed`, with `workflows` (each with its `state`: `to-archive`, `already-archived`, `to-delete` with `--delete`, or `not-found`), or `reset`, with `results` (each with its `action`: `archived`, `already-archived`, `deleted`, `not-found` or `failed`, with its `error`), a `summary` (with `deleted` too, with `--delete`) and `lockFileUpdated`. Every item has `next`, the command to run, or `null`; `kept` lists `{ target, count }` for each other target on the instance. The types live in [`src/core/reset/reset.model.ts`](../../src/core/reset/reset.model.ts) and [`src/core/removal/removal.model.ts`](../../src/core/removal/removal.model.ts).

## Calls

`GET /api/v1/workflows/{id}` for each workflow it removes, then `POST /api/v1/workflows/{id}/archive` for each one it archives. With `--delete`, `DELETE /api/v1/workflows/{id}` follows for each one, after the archive when it was not archived yet.
