# `lift publish`

Publishes the drafts that `lift deploy` delivered: on the n8n instance of the target, each draft becomes the published version, and the workflow runs it on its triggers. Nothing is published until you confirm.

```sh
lift publish                       # every draft waiting to be published, after a [y/N] question
lift publish daily-report          # only the named workflows (stable names)
lift publish daily-report -t prod  # on the target named prod
lift publish --all                 # on every target: one listing, one question
lift publish --yes                 # or -y, -f, --force: no question
lift publish --json --yes          # the result as JSON, for scripts and AI agents
```

`lift help publish` prints every option and the exit codes. The targets come from `boilerlift.config.ts` (see [Configure your targets](../configuration.md)).

## Confirmation

Before publishing, `publish` lists the workflows of every selected target on stderr, then asks once:

```text
lift publish → dev (https://n8n.example.com)
  ^ daily-report  draft not yet published → will be published
  ✗ crm-import    differs from n8n → not published: run lift deploy first
Publish 1 workflow? [y/N]
```

It reads the answer from stdin, TTY or not, so a person and an agent answer the same way. Only `y` or `yes` publishes. Any other answer, an empty one, or a closed stdin prints `Nothing published.` and exits 1. `-y`, `--yes`, `-f` and `--force` skip the question. When nothing is waiting, `publish` asks nothing.

With `--json`, the question still goes to stderr, so stdout holds only the JSON result. A declined run prints `{ "published": false, "message": "Nothing published.", "next": "lift publish … --yes" }`.

## Which workflows

- Without names: every workflow of the project whose draft is waiting to be published (the `draft-pending` state of [`lift status`](status.md)). With none, it prints `Nothing to publish: no draft is waiting to be published.` and exits 0.
- With names: only those workflows, by stable name.
  - A name that matches no workflow file, has no id in `boilerlift.lock.json` (or n8n no longer has that id), or is archived in n8n is unknown. Nothing is published, on any target, and nothing is asked. Each unknown name is listed with its next step (`lift deploy` or `lift status`), and `publish` exits 1.
  - A workflow whose local file differs from the n8n draft (`differs`) is not published: run `lift deploy` first. The others are still published, and `publish` exits 5.
  - A workflow already published (`up-to-date`) is skipped and reported as `already published`. It is not an error.

Your workflows are found by the ids of `boilerlift.lock.json` only, never by name or tag. `publish` never writes `boilerlift.lock.json`.

With `--all`, every target is read first. If one has a problem (an unknown name, an invalid file, a failed read), nothing is published on any target.

```text
lift publish → dev (https://n8n.example.com)
✗ not published     crm-import     differs from n8n: the local file and the n8n draft differ
                    → Run lift deploy first, then lift publish crm-import
^ published         daily-report   workflows/daily-report.json (the workflow now runs this version)
1 published, 0 already published, 1 to deploy first, 0 failed.
```

## Exit codes

0 when every workflow was published or already published, or nothing was waiting. 1 on a usage error, an invalid `boilerlift.config.ts`, `boilerlift.lock.json` or workflow file, an unknown name, or a confirmation that was not yes. 3 when the instance cannot be reached or a read fails, 4 when the API key is rejected: nothing was published. 5 when at least one workflow was not published (it differs from n8n, or n8n refused it); the others were.

## JSON

Each result carries its `action` (`published`, `already-published`, `refused` or `failed`, with its `error`) and `next`, the command to run, or `null`. The types live in [`src/core/publish/publish.model.ts`](../../src/core/publish/publish.model.ts).

## Calls

The reads of `lift status` for the workflows of the project (`GET /api/v1/workflows/{id}`), then `POST /api/v1/workflows/{id}/activate` for each workflow it publishes.
