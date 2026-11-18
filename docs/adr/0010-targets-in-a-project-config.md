# Targets are declared in a required boilerlift.config.ts

One project now reaches several n8n instances (each client's dev and prod), so `N8N_URL` alone cannot say where a command runs. The instances are declared as named targets in `boilerlift.config.ts` at the project root, the default export of `defineConfig`, and `--target <name>` or `--all` picks the ones a command runs on; a single declared target runs without being named. The file is required and `N8N_URL` is no longer read: a breaking change, softened by the starter config every command prints when the file is missing.

## Considered options

- **Keep `N8N_URL` and add per-target variables (`N8N_URL_PROD`).** Rejected: the list of targets and their folders would live in untracked env files, so a fresh clone or CI could not know where workflows go.
- **A JSON or YAML config.** Rejected: a `.ts` file loads natively on Node 22.18 (type stripping), like the workflow files, and `defineConfig` types it in the editor.
- **The URL from an environment variable too.** Rejected: the url is not a secret, and committing it makes the target the same on every machine. Only the API key stays outside the file, in the variable `apiKeyEnv` names.

## Consequences

- `--all` resolves every target (config, API key, folder) before any write, then runs each in turn and continues past a failed one; the exit code is the highest.
- The lock file still keys ids by instance (ADR 0009), so two targets on the same url whose folders hold the same stable name would share one entry: deploy refuses them before writing.
