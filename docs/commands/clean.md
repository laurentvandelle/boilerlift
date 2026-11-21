# `lift clean`

Archives, on the n8n instance of a target, the workflows you removed from the project, then drops their entries from `boilerlift.lock.json`. With `--delete`, it deletes them for good instead. Nothing changes until you confirm.

```sh
lift clean               # list, then ask [y/N] before archiving
lift clean --dry-run     # list what clean would archive; change nothing
lift clean --delete      # delete them for good instead: cannot be undone
lift clean -t prod       # on the target named prod
lift clean --all         # on every target: one listing, one question
lift clean --yes         # or -y, -f, --force: no question
lift clean --json --yes  # the result as JSON, for scripts and AI agents
```

`lift help clean` prints every option and the exit codes. The targets come from `boilerlift.config.ts` (see [Configure your targets](../configuration.md)).

## Which workflows

A workflow is **removed** when `boilerlift.lock.json` records it for the instance of the target, but no workflow file in the folder of **any** target on that instance has its stable name any more. A workflow that another target on the same instance still has a file for is not removed, and clean never proposes it. Every folder of every target on the instance must exist: clean exits 1 otherwise.

Clean lists three groups:

| Group | What it is | What clean does |
| --- | --- | --- |
| Removed from the project | recorded in `boilerlift.lock.json`, no file left | archives it, then drops its entry |
| Not deployed yet | a workflow file of the target with no entry | nothing; next step `lift deploy` |
| Not in my project | a workflow of the instance, not archived, that `boilerlift.lock.json` does not record | nothing, ever |

A removed workflow that is already archived in n8n, or whose id n8n no longer knows (404), has nothing to archive: clean only drops its entry and reports it as `already archived` or `not found`.

Your workflows are found by the ids of `boilerlift.lock.json` only, never by name or tag. By default clean only archives, as a delete in the n8n editor does: the workflow stays on the instance and can be unarchived. It deletes a workflow for good only with `--delete` (see [Delete for good](#delete-for-good)).

## Confirmation

In a terminal, clean lists the removed workflows of every selected target on stderr, then asks once:

```text
lift clean → dev (https://n8n.example.com)
  - legacy      Legacy (leg1): already archived in n8n: its entry will be dropped from boilerlift.lock.json
  - old-report  Old report (old1): will be archived
Clean 2 removed workflows? They are archived in n8n and dropped from boilerlift.lock.json. [y/N]
```

`y` or `yes` cleans them. Enter, any other answer, or a closed stdin prints `Nothing archived.` and exits 0. `-y`, `--yes`, `-f` and `--force` skip the question. When nothing is removed, clean asks nothing.

Without a terminal (stdin is not a TTY), or with `--json`, clean never asks. Unless `--yes` or `--force` is given, it lists the three groups, archives nothing, and exits 11, with `lift clean --yes` as the next step:

```text
lift clean → dev (https://n8n.example.com)
Removed from the project:
  - legacy      Legacy (leg1): already archived in n8n: its entry will be dropped from boilerlift.lock.json
  - old-report  Old report (old1): will be archived
Not deployed yet:
  + invoice-sync  workflows/invoice-sync.json
    → lift deploy
Not in my project (clean never touches them):
  · Hand made (h1)
Confirmation needed: nothing was archived. lift clean --yes archives the 2 removed workflows.
```

`--dry-run` prints the same listing, ends with `Dry run: nothing was archived.`, asks nothing and exits 0.

## Result

```text
lift clean → dev (https://n8n.example.com)
= already archived legacy      Legacy (leg1), entry dropped from boilerlift.lock.json
- archived         old-report  Old report (old1)
1 archived, 1 already archived, 0 not found, 0 failed.
boilerlift.lock.json updated — commit it.
```

A workflow n8n refuses to archive (a key without the `workflow:delete` scope answers 403, or a network error) fails on its own: it keeps its entry, the step to take is printed under it, and the others are still cleaned. Run `lift clean` again once it is fixed.

## Delete for good

`lift clean --delete` deletes the removed workflows for good: no id of them is left on the instance, and they cannot be brought back. It takes `--yes`, `--force`, `--dry-run` and `--json` as clean does. Each removed workflow still on the instance is planned as `will be deleted for good`, archived or not: a workflow archived by hand in the editor is deleted too. The question says the deletion is permanent:

```text
lift clean → dev (https://n8n.example.com)
  - legacy      Legacy (leg1): will be deleted for good
  - old-report  Old report (old1): will be deleted for good
Delete these 2 workflows for good? This cannot be undone. [y/N]
```

Any answer but `y` or `yes` prints `Nothing deleted.`: nothing is archived or deleted. Without a terminal, or with `--json`, and without `--yes`, it lists them, changes nothing and exits 11, with `lift clean --delete --yes` next; `--dry-run --delete` gives the same next step.

Each workflow not archived yet is archived first, then deleted (`DELETE /api/v1/workflows/{id}`), so a failed delete leaves it archived and recoverable. Such a workflow fails as `delete-failed`, keeps its entry, and the run exits 5: run `lift clean --delete` again, and it deletes it. A key without the `workflow:delete` scope answers 403. Workflows that an earlier `lift clean` archived have no entry left: `--delete` cannot find them. See [ADR 0017](../adr/0017-clean-can-delete-removed-workflows.md).

```text
lift clean → dev (https://n8n.example.com)
- deleted          legacy      Legacy (leg1)
- deleted          old-report  Old report (old1)
2 deleted, 0 not found, 0 failed.
boilerlift.lock.json updated — commit it.
```

With `--all`, every target is read first. If one has a problem (an invalid `boilerlift.lock.json`, a failed read), nothing is archived or deleted on any target.

## Exit codes

0 when every removed workflow was cleaned, nothing was removed, on a dry run, or when the answer was not yes. 1 on a usage error, an invalid `boilerlift.config.ts` or `boilerlift.lock.json`, or a missing workflows folder. 3 when the instance cannot be reached or a read fails, 4 when the API key is rejected: nothing was archived. 5 when at least one workflow was not cleaned; the others were. 11 when workflows are removed but clean could not ask (no terminal, or `--json`) and neither `--yes` nor `--force` was given: nothing was archived.

## JSON

Each target carries its `stage`: `nothing-to-clean`, `dry-run` or `confirmation-needed`, with `removed` (each with its `state`: `to-archive`, `already-archived`, `to-delete` with `--delete`, or `not-found`), or `cleaned`, with `results` (each with its `action`: `archived`, `already-archived`, `deleted`, `not-found` or `failed`, with its `error`), a `summary` (with `deleted` too, with `--delete`) and `lockFileUpdated`. Every item has `next`, the command to run, or `null`; `notDeployed` and `unmanaged` list the two other groups. The types live in [`src/core/clean/clean.model.ts`](../../src/core/clean/clean.model.ts).

## Calls

`GET /api/v1/workflows/{id}` for each removed workflow, every page of `GET /api/v1/workflows` for the ones `boilerlift.lock.json` does not record, then `POST /api/v1/workflows/{id}/archive` for each workflow it archives. With `--delete`, `DELETE /api/v1/workflows/{id}` follows for each one, after the archive when it was not archived yet.
