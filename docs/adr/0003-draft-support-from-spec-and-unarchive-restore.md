# Check draft support from the instance's API spec, and restore archived workflows by unarchiving them

Before any write, `deploy` reads `GET /api/v1/openapi.yml` (served by every n8n version, without auth) and requires the text `publishIfActive`, the query parameter that makes an update land as a draft and that first appears in n8n 2.35.0. The public API has no version endpoint, and an older instance rejects the parameter only on the first `PUT`, once creates may already have run, so a version check is not possible and a try-and-see leaves the instance half deployed. Reading the spec asks the instance what it accepts, before anything changes; a spec that is missing, answers an error or lacks the parameter stops deploy with exit 6.

A workflow deleted in the n8n editor is only archived: it stays in `GET /api/v1/workflows` with `isArchived` and keeps its `boilerlift:` tag. `deploy` brings it back with `POST /api/v1/workflows/{id}/unarchive`, then updates it as a draft, instead of creating a new workflow. The workflow keeps its id, its execution history and its tags, and no tag has to move from the archived copy to a new one. The cost is that the API key needs the `workflow:delete` scope; without it, only that workflow fails, with a hint to unarchive it in the editor or widen the key.

## Consequences

- A failure on one workflow, a duplicate live `boilerlift:` tag included, now fails only that workflow (exit 5) instead of stopping deploy before any change, as ADR 0002 described. An unreachable instance or a rejected key still stops the rest.
- A workflow deleted through the API leaves no trace, so the next deploy creates it again, with no warning.
