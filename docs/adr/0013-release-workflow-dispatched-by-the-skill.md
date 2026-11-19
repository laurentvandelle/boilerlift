---
status: accepted
---

# The release skill dispatches the release workflow after the merge

Supersedes ADR-0012 on one point: what starts `.github/workflows/release.yml`. The flow stays a local skill, then a `chore(release): vX.Y.Z` pull request, then a workflow that publishes to npm with trusted publishing (OIDC, with provenance), tags the commit and creates the GitHub release. But merging the pull request publishes nothing: the workflow runs on `workflow_dispatch` only, and the release skill dispatches it on `main` when the maintainer asks after the merge. The goal: the maintainer chooses the moment a version goes out, apart from the merge, and a push to `main` never starts a release.

## Considered options

- **Publish on merge (ADR-0012).** Rejected: the merge and the publish are two decisions, and every push to `main` ran the workflow only to find nothing to do.
- **Push a `v*` tag to start the workflow.** Rejected: the tag would exist before the package is on npm, and the order is npm, then tag, then GitHub release.

## Consequences

- The workflow tags the commit it runs on, so the skill dispatches only when the merge commit is the head of `main`.
- Each step still checks before acting, so a re-run or a second dispatch finishes a partial release without duplicating anything.
- The npm trusted publisher on npmjs.com still names workflow `release.yml`: the trigger is not part of the match.
