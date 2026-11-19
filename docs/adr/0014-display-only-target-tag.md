# Deploy writes a display-only target tag; recognition never uses tags

People working in the n8n editor cannot tell which target a workflow belongs to, since the lock file (ADR 0009) is invisible there. `deploy` now adds a tag named after the target (`sales-prod`) to every workflow it delivers, the skipped ones included, so workflows deployed earlier get it too. A target turns it off with `tag: false` in `boilerlift.config.ts`. The tag is for display only: deploy still recognises its workflows by the lock-file ids alone, never by this tag or any other.

## Considered options

- Go back to finding workflows by tag (ADR 0002): a tag can be removed or added by hand in the editor, and two projects on one instance could share a target name. The lock file stays the only identity.
- A tag name other than the target's name: one more thing to configure and keep in sync, for no need seen yet.
- Make a tag failure fail the workflow: the tag carries no meaning for deploy, so an API key without tag rights must not block delivery. A failure is a warning; the action, the lock file and the exit code stay the same.

## Consequences

- A target name is capped at 24 characters, n8n's longest tag name, whether the tag is on or off, so turning it on later never breaks the config.
- Setting a workflow's tags replaces the whole list: deploy sends the tags the workflow already has plus the target tag, so tags added by hand are kept. A workflow that already has the target tag gets no tag write.
- The tag is found on the instance by name and created when missing. Turning the tag off later does not remove it from workflows already tagged.
