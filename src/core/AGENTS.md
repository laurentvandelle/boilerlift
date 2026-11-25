# AGENTS.md — src/core

## Prohibitions

- Each folder imports only what its `boundaries/dependencies` policy in `eslint.config.mts` allows. Lint enforces all of these:
  - `compile/` imports only `config/` and `common/`. It never imports `deliver/`, `n8n/` or `connection/`: no network.
  - `deliver/` (deploy) may import `lock/`, `compile/`, `config/` and `n8n/`. `connection/` (ping) may import `config/` and `n8n/`. Neither imports the other.
  - `status/` (status) may import `deliver/`, `lock/`, `compile/`, `config/` and `n8n/`. Only `publish/` imports it.
  - `publish/` (publish) may import `status/`, `lock/`, `compile/`, `config/` and `n8n/`. Nothing in `core/` imports it.
  - `clean/` (clean) may import `removal/`, `lock/`, `compile/`, `config/` and `n8n/`. Nothing in `core/` imports it.
  - `reset/` (reset) may import `removal/`, `lock/`, `compile/`, `config/` and `n8n/`. Nothing in `core/` imports it.
  - `removal/` (shared by clean and reset) may import `lock/`, `compile/` and `n8n/`. Only `clean/` and `reset/` import it in `core/`.
  - `credentials/` (creds sync) may import `compile/`, `config/` and `n8n/`. Nothing in `core/` imports it.
  - `lock/` (the lock file, shared by every command) may import only `compile/` and `n8n/`, for stable names and ids. It imports no stage.
  - A shared folder (`config/`, `n8n/`, `common/`) imports neither `compile/`, `deliver/`, `status/`, `publish/`, `clean/`, `reset/`, `removal/`, `lock/` nor `credentials/`.
  - `core/` never imports `src/services/`. Use the `N8nClient` port of `n8n/n8n.model.ts`; its adapter lives in `src/services/n8n/`.
- A new folder needs its own element and policy in `eslint.config.mts`: a file in no element fails `boundaries/no-unknown-files`.
- A `StableName`, `WorkflowId` or `TagId` comes only from its guard: `isStableName` (`compile/load-workflows.ts`), `isWorkflowId` and `isTagId` (`n8n/n8n-ids.ts`). The ban on type assertions leaves no other way to make one.
- Each command of `cli/commands/` that runs on targets has one use case in its feature folder: `deliverTargets` (`deliver/deliver.ts`), `planPublishTargets` and `applyPublishTargets` (`publish/publish-targets.ts`), `planCleanTargets` and `applyCleanTargets` (`clean/clean-targets.ts`), `planResetTarget` and `applyResetTarget` (`reset/reset-target.ts`), `readStatusTargets` (`status/status-targets.ts`). It takes the selected `ConnectedTarget`s (`n8n/n8n.model.ts`) and its ports (a `WorkflowFileLoader`, `compile/workflow.model.ts`; the `LockStore` or `LockReader` of `lock/lock-file.model.ts`), and returns a union tagged by `kind`, per target or for the run. A use case that removes or publishes returns `needs-confirmation` and leaves the question to the command; its confirmation rule sits beside it (`isPublishConfirmed`, Enter is yes; `isCleanConfirmed`, Enter is no; `isResetConfirmed`, the exact target name). No check enforces this.
- The managed workflow ids come only from `managedIds` (`lock/lock-file.ts`), read from the lock file with `readLock`. Deploy never finds a workflow by its name or tag (`docs/adr/0009-lock-file-identity.md`). No check enforces this.

## Shape

- `compile/` reads and validates workflow files: the `defineWorkflow` types for the editor, and the loader that checks each export before deploy. It does no I/O: the files come in through `CommandContext.loadWorkflowFiles`. `isWorkflowFilePath` alone decides which paths are workflow files. Why typed exports: `docs/adr/0005-workflow-files-are-typed-n8n-exports.md`.
- `deliver/` is deploy: `deliver.ts` is the use case (`loadDeliverySources` reads the credential lists and every declared folder and refuses targets that share an entry; `deliverTargets` runs each target), `plan-deploy.ts` reads and decides each workflow's action, after `resolve-credentials.ts` resolves the `credential()` markers through the list of the target, `apply-plan.ts` runs the writes (`docs/adr/0004-deploy-plans-before-it-writes.md`). `deploy-failure.ts` holds `EFFECTS`, the one table that says which deploy errors stop the run and with which exit code.
- `status/` is status: `readStatusTargets` (`status-targets.ts`) is the use case; `readStatus` reads, with GET calls only, the state of each workflow of a target. It reuses `isSameContent` of `deliver/` and `managedIds` of `lock/`, and never writes.
- `publish/` is publish: `publish-targets.ts` is the use case; `planPublish` works out, from the reads of `readStatus`, which workflows publish touches; `applyPublish` makes each draft the published version. It never writes the lock file.
- `clean/` is clean: `clean-targets.ts` is the use case; `planClean` reads, with GET calls only, the removed workflows (the entries `removedEntries` of `lock/lock-file.ts` gives, from the files of every target on the instance), the files not deployed yet and the unmanaged workflows (`docs/adr/0016-clean-archives-removed-workflows.md`, amended by `docs/adr/0017-clean-can-delete-removed-workflows.md`).
- `reset/` is reset: `reset-target.ts` is the use case; `planReset` reads, with GET calls only, every entry of the instance but those whose stable name has a file in another target's folder there, and counts the entries it keeps per other target (`docs/adr/0018-reset-scope-on-a-shared-instance.md`).
- `removal/` is what clean and reset share: `readWorkflowsToRemove` reads each entry by its recorded id; `applyRemoval` archives each one and drops its entry through a `LockRemover`. In `delete` mode (`--delete`) it archives each one first, then deletes it for good. A 404 counts as removed; a 403 or another failure keeps the entry and exits 5.
- `credentials/` is creds sync: `syncCredentials` reads the credentials with GET calls only, writes `credentials/<target>.ts` through the `CredentialsWriter` it is given, and reports the missing keys. `credential()`, `defineCredentials` and `findCredentialUses` live in `compile/credential.ts`, since workflow files import them and deploy scans for markers; the readers of the generated lists (`CREDENTIALS_DIR`, `credentialsFilePath`, `knownCredentialTypes`, `targetCredentials`) live in `compile/credential-lists.ts`, since `deliver/` may not import `credentials/` (`docs/adr/0015-credential-lists-are-generated-project-files.md`).
- `connection/` is ping: the checks that `lift ping` runs.
- `lock/` is the lock file: `lock-file.ts` parses and serializes `boilerlift.lock.json`, reads it through a `LockStore` (`readLock`), gives the managed ids (`managedIds`), the stable names still in the folders of an instance (`presentStableNames`) and the removed entries (`removedEntries`), and builds the `LockWriter` of deploy and the `LockRemover` of clean and reset (`docs/adr/0009-lock-file-identity.md`). A failed write is a `LockWriteError`, the `lock-write-failed` member of `DeployError`.
- Shared folders: `config/` (the targets of `boilerlift.config.ts`, `defineConfig`, and the selection of the targets a command runs on), `n8n/` (the `N8nClient` port in `n8n.model.ts`, the id guards, what Boilerlift relies on in the public API in `n8n-api.ts`, and the shared fake), `common/` (what several folders use: every exit code in `exit-codes.ts`, `isRecord` in `is-record.ts`, `Result` in `result.ts`, and `everyTargetReady` in `every-target-ready.ts`, the rule of publish and clean that nothing is written on any target while one of them is not ready).
- Past the `N8nClient` port, the types are trusted: the adapter (`src/services/n8n/`) parses every body once. An `invalid-response` failure is treated like an unreachable instance (exit 3).
- Each folder holds its code, its tests and its `*.model.ts`.

## Tests

- Tests reach the instance through `fakeN8n().client` (`n8n/n8n.fake.ts`), the shared in-memory instance, never a real one and never a new stand-in.

## Example

- `src/core/deliver/plan-deploy.ts` and `src/core/deliver/deploy.test.ts`
