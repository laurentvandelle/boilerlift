---
name: release
description: Prepares a boilerlift release. Reads the commits and the diff since the last v* tag, runs verify and build, proposes the next version, writes the Keep a Changelog notes, and after an explicit "yes" opens a `chore(release): vX.Y.Z` pull request. Merging that pull request makes `.github/workflows/release.yml` publish to npm, tag and create the GitHub release. Use when the maintainer asks to release, cut a version, ship a version or publish boilerlift.
---

# Release boilerlift

A release takes two OKs from the maintainer: the "yes" in this skill, which opens the release pull request, and the merge of that pull request, which publishes. This skill never publishes, tags, creates a GitHub release or pushes to `main`. Why the flow works this way: `docs/adr/0012-release-pr-then-publish-on-merge.md`.

## 1. Start from an up-to-date main

```bash
git fetch origin --tags
git status --short --branch
```

Stop when the working tree is not clean, the branch is not `main`, or `main` is behind `origin/main`. Say why.

## 2. Read everything since the last release

```bash
last=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null)
```

- A tag was found: the range is `$last..HEAD`.
- No tag yet: the range is everything since the first commit (`HEAD`).

Read every commit in the range (`git log <range> --format='%H%n%s%n%b%n---'`) and what changed (`git diff $last..HEAD` after a tag; with no tag, `git log --stat HEAD` and the files as they stand). No commit in the range: stop and say there is nothing to release.

## 3. Check before showing anything

```bash
npm run verify
npm run build
```

Either fails: stop, show the error, and change nothing.

## 4. Propose the version

The current version is `version` in `package.json`, the single source of the release version (`lift --version` reads it).

- **First release** (no `v*` tag yet): the version is `0.1.0`, whatever the commits say.
- **Below 1.0**:
  - a breaking change (`!` after the type, or a `BREAKING CHANGE` footer): minor bump;
  - a `feat` commit: minor bump;
  - anything else: patch bump.
- **1.0 and above**: `feat` gives a minor bump, anything else a patch. Point out each breaking change and let the maintainer decide on a major bump.
- **Non-conventional commits** are released too. File each one under the Keep a Changelog section it belongs to, but never let one raise the proposed bump above patch.
- **Major** happens only when the maintainer chooses it. Never propose it yourself.
- No pre-releases (`beta`, `rc`).

The maintainer can confirm the proposal or name another version.

## 5. Write the release notes

Write in English, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format: one `## [X.Y.Z] - YYYY-MM-DD` heading (today's date), then only the sections that have entries, in this order: `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.

- One bullet per change a user of the CLI or the package would notice, written for them, not a copy of the commit subject. Merge commits that make one change into one bullet.
- Leave out changes with no effect on users (CI, tests, refactors, internal docs) unless nothing else changed.
- Breaking changes go first in their section and start with `**Breaking:**`.
- No link references at the bottom of the file: the workflow takes the release body from the lines between this heading and the next `## [` heading.

## 6. Prepare the release branch locally

```bash
git switch -c release/vX.Y.Z
npm version X.Y.Z --no-git-tag-version
```

`npm version` updates `package.json` and `package-lock.json`. Insert the new section in `CHANGELOG.md` after the introduction, above the previous release, so the newest version comes first.

Show the maintainer, then wait:

1. the proposed version and why (the bump rule that applied);
2. the release notes;
3. `git diff CHANGELOG.md package.json package-lock.json`.

Ask for an explicit "yes" to open the release pull request.

## 7a. On an explicit "yes"

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --base main --head release/vX.Y.Z --title "chore(release): vX.Y.Z" --body-file <the new CHANGELOG section>
```

Give the maintainer the pull request URL. Merging it is the second and final OK: the release workflow then runs `npm run verify` and `npm run build`, publishes `boilerlift@X.Y.Z` to npm with provenance, creates the `vX.Y.Z` tag on the merge commit, and creates the GitHub release whose body is the new CHANGELOG section. Do not merge it yourself.

## 7b. Anything other than an explicit "yes"

Throw the release away. Nothing has left the machine, and nothing must:

```bash
git restore --staged --worktree CHANGELOG.md package.json package-lock.json
git switch main
git branch -D release/vX.Y.Z
```

No push, no pull request, no tag, no GitHub release, no npm version, no change on `main`.

## When a release is half done

Every step of `.github/workflows/release.yml` checks before it acts: it skips the npm publish when `npm view boilerlift@X.Y.Z` returns a version, the tag when `vX.Y.Z` exists, and the GitHub release when it exists. Re-run the failed run, or dispatch the workflow on `main` (`gh workflow run release.yml --ref main`), to finish a partial release. Its job summary lists npm, tag and GitHub release as published, skipped (already done) or not done.

## One-time setup on npmjs.com

The workflow authenticates with npm trusted publishing (OIDC): there is no npm token in the repository secrets. The maintainer sets it up once, by hand, on npmjs.com: package `boilerlift` → Settings → Trusted publishing → GitHub Actions, with owner `laurentvandelle`, repository `boilerlift`, workflow `release.yml`, no environment.

npm configures a trusted publisher on an existing package only. If `boilerlift` is not on npm yet when the first release pull request is merged, the workflow's npm step fails and its tag and release steps do not run. The maintainer then publishes that merged commit once from their machine (`npm publish --access public` on an up-to-date `main`), configures the trusted publisher, and dispatches the workflow: it skips npm and creates the tag and the GitHub release.
