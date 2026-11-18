---
status: accepted, supersedes the identity part of ADR-0002
---

# Identify deployed workflows by their n8n id, recorded in `boilerlift.lock.json`

`deploy` found its workflows through the `boilerlift:<stable-name>` tag (ADR 0002). That breaks once several targets share one instance, and some clients want no Boilerlift tag on their workflows. The identity now lives in the project: `boilerlift.lock.json` at the project root records, for each instance (its cleaned-up `N8N_URL`), the n8n id of each stable name. `deploy` recognises a managed workflow by that id only, never by name or tag. The record is written only when deploy creates a workflow, or creates it again because its recorded id answers 404, and it is saved after each one. The user commits it.

## Considered options

- Keep the tag: it cannot tell two targets on one instance apart, and it puts a Boilerlift marker on the client's workflows.
- Match by workflow name: a rename in the editor would break the link, and names are not unique.
- Let CI commit the lock file after a deploy: CI then needs write access to the repository, and a deploy would push commits on its own. The user commits it instead, as with any lockfile.

## Consequences

- The record can be out of date: a lock file that was not committed, or an older checkout, does not know a workflow that another deploy created, so the next deploy creates a duplicate. This risk is accepted; the text report says `boilerlift.lock.json updated — commit it` each time it changes.
- A recorded id that n8n no longer knows (404) is created again from code and its new id recorded. An archived one is restored, as before (ADR 0003), and the record is untouched.
- A workflow on the instance that the record does not list is never read or changed. A workflow removed from the project keeps its entry and is left alone.
- A lock file that cannot be read or is invalid stops deploy before any call (exit 1). A record that cannot be written after a create stops the run (exit 7) and names the created id, so the user can record it by hand.
- Deploy no longer reads or writes tags. The tags earlier versions set stay on the workflows, and those workflows are not taken over: with no record, deploy creates them again. Delete or archive the old copies in the n8n editor.
- With no tag-length limit, a stable name now runs from 1 to 64 characters (`^[a-z0-9-]{1,64}$`).
