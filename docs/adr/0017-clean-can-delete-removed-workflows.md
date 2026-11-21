---
status: accepted, amends the "only archives, never deletes for good" of ADR-0016
---

# `lift clean --delete` deletes the removed workflows for good, always after an archive

ADR 0016 made clean archive the workflows removed from the project and never delete one for good. Archived workflows pile up on the instance, so `lift clean --delete` now deletes them for good (`DELETE /api/v1/workflows/{id}`), after a confirmation that says the deletion cannot be undone. Archiving stays the default and recoverable: deletion is an explicit opt-in. Each workflow not archived yet is archived first, then deleted, so a failed delete leaves it archived and recoverable, with its lock entry kept for the next `lift clean --delete`. This works whether or not the n8n version requires an archive before a delete. With `--delete`, a removed workflow already archived on the instance (by hand in the editor) is deleted too.

## Considered options

- Delete by default: a mistake in the project folders would destroy workflows that cannot be brought back.
- Delete without archiving first: some n8n versions refuse it, and a failed delete would leave a running workflow behind.
- Delete the workflows a previous clean archived: their lock entry is gone, so clean could only find them by name or tag, which ADR 0009 rules out.
