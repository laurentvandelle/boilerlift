# Contributing to Boilerlift

Thanks for your interest. Boilerlift is an early-stage project with best-effort support, so small, focused contributions are the easiest to review.

## Before you start

- **Bugs:** open an issue with the bug report template.
- **Features:** open an issue first to discuss the idea before writing code, so your work fits the roadmap.
- **Security issues:** follow [SECURITY.md](SECURITY.md), not a public issue.

Issues labelled [`good first issue`](https://github.com/laurentvandelle/boilerlift/labels/good%20first%20issue) are a good place to start.

## Setup

Requires Node.js 22.18 or later. Development uses the version in `.nvmrc` (24).

Requires npm 11.21.3, the version in `devEngines` of `package.json`: npm refuses to install with another one. Other versions write `package-lock.json` differently, and CI installs with `npm ci`, which fails on a lock file out of sync.

```sh
git clone https://github.com/laurentvandelle/boilerlift.git
cd boilerlift
npm install -g npm@11.21.3
npm install
npm run verify   # lint, typecheck, tests
```

| Task                                                                          | Command               |
| ----------------------------------------------------------------------------- | --------------------- |
| Build into `dist/`                                                            | `npm run build`       |
| Build, then run `lift <cmd>` in `debug/` against the instance in `debug/.env` | `npm start -- <cmd>`  |
| Install, build and link `debug/` in a new worktree                            | `npm run debug:setup` |
| Tests                                                                         | `npm run test`        |
| Tests in watch mode                                                           | `npm run test:watch`  |
| Lint with autofix                                                             | `npm run lint`        |
| Type-check                                                                    | `npm run typecheck`   |

`npm start -- <cmd> [args]` builds `dist/`, then runs `debug/main.ts` in `debug/`, which runs `dist/bin.js <cmd> [args]` as an external consumer would: `npm start -- status`, `npm start -- deploy --json`. Every run builds first, so it always uses the current code, a fix included. With no argument it runs a real `lift deploy` of `debug/workflows` to the target in `debug/boilerlift.config.ts`, whose url and API key come from `debug/.env`: point it at a test instance.

`npm run debug:setup` gets a checkout ready for `npm start`: it installs the root dependencies, builds, installs `debug/` dependencies, and in a git worktree links `debug/boilerlift.lock.json` to the main checkout's copy (creating an empty one there first when it is missing), so every worktree shares one record of the instance and a first deploy from a new worktree does not duplicate workflows. It is safe to run again and never runs lift. `boilerlift.lock.json` and `.env*` files (except `.env.example`) stay gitignored. `/boilerlift:ship` (`.claude/skills/boilerlift:ship/`) runs it in each new worktree.

## Project layout

Read [ARCHITECTURE.md](ARCHITECTURE.md) before crossing a module boundary or adding a dependency, and [GLOSSARY.md](GLOSSARY.md) before naming a domain concept, and [docs/testing.md](docs/testing.md) before writing a test. Architecture decisions are recorded in [docs/adr](docs/adr/README.md).

The `AGENTS.md` files describe conventions per folder. They are written for coding agents but apply to human contributors too.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused on one topic. Add or update tests.
3. Run `npm run verify` and make sure it passes. CI runs the same check.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, for example `feat(cli): add deliver command` or `fix: handle empty workflow`.
5. Open the pull request and fill in the template. Link the issue it closes.

Do not edit `dist/`, bump the version in `package.json` or edit `CHANGELOG.md`. Releases are done by the maintainer.

## Releases

The maintainer runs the release skill (`.claude/skills/release/SKILL.md`). It proposes the next version from the commits since the last `v*` tag, writes the [CHANGELOG.md](CHANGELOG.md) entry, and opens a `chore(release): vX.Y.Z` pull request. Merging that pull request publishes nothing. When the maintainer then asks, the skill dispatches `.github/workflows/release.yml`: after lint, typecheck, tests and build pass, it publishes the version to npm with provenance, tags the commit `vX.Y.Z`, and creates the GitHub release from the CHANGELOG section.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
