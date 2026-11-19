# Deploy writes a display-only target tag; recognition never uses tags

People working in the n8n editor cannot tell which target a workflow belongs to, since the lock file (ADR 0009) is invisible there. `deploy` now adds the tag `boilerlift:<target>` (`boilerlift:prod`) to every workflow it delivers, the skipped ones included, so workflows deployed earlier get it too. A target turns it off with `tag: false` in `boilerlift.config.ts`. The tag is for display only: deploy still recognises its workflows by the lock-file ids alone, never by this tag or any other.

## Considered options

- Go back to finding workflows by tag (ADR 0002): a tag can be removed or added by hand in the editor, and two projects on one instance could share a target name. The lock file stays the only identity.
- The bare target name as the tag (`prod`): it could clash with a tag the user already has, and says nothing about where it comes from. A tag name the user picks: one more thing to configure and keep in sync, for no need seen yet.
- Make a tag failure fail the workflow: the tag carries no meaning for deploy, so an API key without tag rights must not block delivery. A failure is a warning; the action, the lock file and the exit code stay the same.

## Consequences

- n8n caps tag names at 24 characters, so a target name is capped at 13 (24 minus `boilerlift:`), whether the tag is on or off, so turning it on later never breaks the config.
- Before ADR 0009, deploy tagged each workflow `boilerlift:<stable-name>`. A target named like an old stable name reuses that old tag, found by name. Both are display-only now, so this is accepted.
- Setting a workflow's tags replaces the whole list: deploy sends the tags the workflow already has plus the target tag, so tags added by hand are kept. A workflow that already has the target tag gets no tag write.
- The tag is found on the instance by name and created when missing. Turning the tag off later does not remove it from workflows already tagged.
