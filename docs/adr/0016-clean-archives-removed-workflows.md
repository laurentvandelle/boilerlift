---
status: accepted, amends the "removed from the project" consequence of ADR-0009; its "only archives" is amended by ADR-0017
---

# `lift clean` archives the workflows removed from the project, and drops their lock entries

ADR 0009 left a workflow removed from the project alone: its entry stayed in `boilerlift.lock.json`, and the workflow stayed on the instance, still published. `lift clean` now archives such a workflow, after one confirmation for the whole list (or `--yes` / `--force`), then drops its entry. A workflow is removed when the lock file records it for an instance but no workflow file in the folder of **any** target on that instance has its stable name: one target's folder alone would archive a workflow that another target on the same instance still deploys. Clean never touches a workflow the lock file does not record, and it only archives, never deletes for good.

## Considered options

- Archive from `deploy`: a deleted file would archive a running workflow as a side effect of a deploy, with no confirmation.
- Delete the workflow for good: it cannot be undone, and n8n's own delete in the editor only archives.
- Keep the entry after archiving: the lock file would keep growing with ids no file points to, and status would keep showing them. Dropping it matches the project; an archived workflow left in n8n can still be restored by hand.
- Mark the entry with its target or folder: it changes the lock file format. Reading the folders of every target on the instance answers the same question without a new field.

## Consequences

- Without a terminal, or with `--json`, clean never asks: it lists the workflows, archives nothing and exits 11 (`EXIT_CONFIRMATION_NEEDED`) until `--yes` is given, so a script or an agent never archives by accident.
- Every folder of every target on the instance must exist: a missing folder would make its workflows look removed.
- A workflow already archived, or whose id answers 404, has nothing to archive: clean only drops its entry. A workflow n8n refuses to archive keeps its entry, and the next clean tries again.
