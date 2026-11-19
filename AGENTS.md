# AGENTS.md

Instructions for every coding agent. Humans read `README.md` and `ARCHITECTURE.md`.

## Role

This repository is `boilerlift`, a TypeScript CLI published to npm that validates typed workflow files and delivers them to n8n. Source lives in `src/`: the `lift` command (alias `boilerlift`) starts in `src/bin.ts`; `src/index.ts` is the package entry point and exports `defineWorkflow` and the workflow types. `debug/` runs the built `dist/bin.js` like an external user.

## Commands

Local setup: see `CONTRIBUTING.md`. Package manager: npm (`package-lock.json`).

| Task                                          | Command              |
| --------------------------------------------- | -------------------- |
| Build (`tsc` into `dist/`)                    | `npm run build`      |
| Build, then deploy `debug/workflows` for real | `npm start`          |
| Run tests (Vitest)                            | `npm run test`       |
| Tests in watch mode                           | `npm run test:watch` |
| Lint, check only                              | `npm run lint:check` |
| Lint with autofix                             | `npm run lint`       |
| Type-check, no emit                           | `npm run typecheck`  |
| Lint check, type-check, tests                 | `npm run verify`     |

Run `npm run verify` before handing work back.
Never hand back a failure: fix it, then run the command again.

Releases go through a release pull request, and its merge publishes to npm (`.github/workflows/release.yml`). Never publish, tag or create a GitHub release by hand, and never open a release pull request unless the user asks.

`npm start` builds, then runs a real `lift deploy` (no `--dry-run`) of `debug/workflows` to the n8n instance in `debug/.env`: it writes drafts and tags to the user's instance. Never run it, or the built CLI from `debug/`, unless the user asks.

## Routing

- Before editing `src/**`, read `src/AGENTS.md`.
- Before editing `src/cli/**`, read `src/cli/AGENTS.md`.
- Before editing `src/core/**`, read `src/core/AGENTS.md`.
- Before editing `src/services/**`, read `src/services/AGENTS.md`.
- Before editing `.github/scripts/**`, read `.github/scripts/AGENTS.md`.
- Before adding a dependency or crossing a module boundary, read `ARCHITECTURE.md`.
- Before naming a domain concept, read `GLOSSARY.md`.
- Before writing or changing a test, read `docs/testing.md`.
- Before writing an architecture decision, read `docs/adr/README.md`.
- Before preparing a release, read `.claude/skills/release/SKILL.md`.
- Before changing these instruction files, read `docs/agents.md`.
- Before treating a convention as enforced, read `docs/guardrails.md`.
- Before adding a convention after review, read `docs/maintenance.md`.

## Non-negotiables

1. The `AGENTS.md` closest to the file being changed wins over the root file.
2. The code is the source of truth. When a document and the code disagree, report the gap. Do not invent a reconciliation in the same task.
3. A rule lives in one file. Local rules live in the nearest `AGENTS.md`. The root file keeps shared rules only.

- Do not edit `dist/`. It is build output from `npm run build`.

## Boundaries

- `debug/` uses only the built `dist/` (it runs `dist/bin.js` and depends on `boilerlift` as `file:../dist`). It never imports from `src/`.

No check enforces this. `tsconfig.json` excludes `debug/` and ESLint ignores it. Boundaries inside `src/` are in `src/AGENTS.md`.

## Maintenance

Instruction files are code and drift without upkeep.
Before adding or changing a rule after review, read `docs/maintenance.md`.
