---
status: accepted
---

# lift init fetches the Project template with git clone

`lift init <folder>` gets the Project template of its own version by running `git clone --depth 1 --branch vX.Y.Z` of boilerlift-template into a temp folder, then writes its files into a new or empty folder. git becomes a requirement of `lift init`: the skills of the template already require it, and it keeps boilerlift free of runtime dependencies. The repository URL is one constant in `src/services/git/project-template.ts`, with no flag or environment variable to override it, and a missing tag is an error (exit 13), never a fallback to `main`.

## Considered options

- **Download the codeload tarball of the tag and read it with a hand-written tar reader.** Rejected: a tar and gzip reader to write and maintain, for what git already does.
- **Add `tar` or `degit` as a runtime dependency.** Rejected: boilerlift has no runtime dependencies, and every new one ships to every project.
- **Read the files through the GitHub contents API.** Rejected: one call per file, under an unauthenticated rate limit that a few runs exhaust.

## Consequences

- `lift init` needs git on the PATH and the network. Without either, it writes nothing and exits 13.
- The template no longer ships in the npm package: `templates/project/` is gone, and a local build of an unreleased version has no tag to clone.
