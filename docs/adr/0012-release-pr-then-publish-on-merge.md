---
status: accepted
---

# A release is a local skill, then a release pull request, then a publish on merge

A version ships in three steps. The release skill (`.claude/skills/release/SKILL.md`) runs on the maintainer's machine: it reads the commits and the diff since the last `v*` tag, runs verify and build, proposes the version, and writes the Keep a Changelog entry. After an explicit "yes" it opens a `chore(release): vX.Y.Z` pull request that bumps `package.json`, `package-lock.json` and `CHANGELOG.md`. Merging that pull request runs `.github/workflows/release.yml`, which publishes to npm with trusted publishing (OIDC, with provenance), tags the merge commit and creates the GitHub release from the CHANGELOG section. `npm run pub` is gone: nothing publishes from a laptop. The goal: one deliberate action per version, release notes written for users rather than copied from commit subjects, and no long-lived npm token anywhere.

## Considered options

- **release-please.** It keeps a release pull request open and rewrites it on every merge, from commit subjects alone. Rejected: the notes are only as good as the commit subjects, non-conventional commits are dropped, and the bump rules below 1.0 are fixed by its config rather than confirmed by the maintainer.
- **changesets.** Each pull request adds a change file. Rejected: a single-maintainer project gains a step on every pull request, and the notes would still be written before the release is seen as a whole.
- **Publish on every merge.** Rejected: a version is a promise to users, and the maintainer wants to choose when to make it.

## Consequences

- The workflow runs on every push to `main` and on `workflow_dispatch`. It tells a release merge from any other push by the version in `package.json`: it acts only when `CHANGELOG.md` has a section for that version and the npm version, the `vX.Y.Z` tag or the GitHub release is missing. Each step checks before acting, so re-running finishes a partial release without duplicating anything.
- The order is npm, then tag, then GitHub release: the tag and the release only exist once the package is on npm.
- The npm trusted publisher is configured once by hand on npmjs.com (package `boilerlift`, repository `laurentvandelle/boilerlift`, workflow `release.yml`). npm sets it up on an existing package only, so the very first publish may have to be done by hand; the skill gives the steps.
