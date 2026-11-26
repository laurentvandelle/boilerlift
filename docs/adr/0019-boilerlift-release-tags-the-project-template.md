---
status: accepted
---

# The Project template lives in boilerlift-template, and boilerlift's release tags it

The Project template is edited only in the `boilerlift-template` repository. Its `main` holds the latest template, and each boilerlift version `X.Y.Z` has one tag `vX.Y.Z` there, created only by boilerlift's `.github/workflows/release.yml`. Every check runs from boilerlift: each pull request checks a fresh project from its Template branch against the boilerlift it packs, and the release runs the same check on the Template branch's SHA before `npm publish`, so a failure blocks the release. boilerlift-template itself holds no CI or release tooling.

## Considered options

- **Copy the template from this repository at release.** Rejected: the template would have two homes, and edits in boilerlift-template would be overwritten.
- **Mirror the template to boilerlift-template on every merge (decision of #81).** Rejected: `main` there would move ahead of the published boilerlift it depends on.

## Consequences

- A change that needs both repositories goes on a boilerlift-template branch named after the boilerlift pull request branch. It must fast-forward boilerlift-template `main`, and the release ships it by fast-forwarding `main` to the checked SHA, then deletes it.
- Writing to boilerlift-template needs a GitHub App installed on that repository only; its app id and private key are secrets of boilerlift.
- `release.yml` packs boilerlift once, checks that `.tgz` and publishes it, so what is checked is what ships.
