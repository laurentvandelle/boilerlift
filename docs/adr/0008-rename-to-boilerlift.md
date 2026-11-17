# Rename n8nlift to Boilerlift, with the `lift` command

The product was published as `n8nlift`. Before the first public release it becomes Boilerlift: the npm package `boilerlift` installs two bins, `lift` and `boilerlift`, both pointing to `dist/bin.js`. Help and messages show `lift`, and `boilerlift` is the alias for a shell where `lift` is already taken. Workflow files import from `'boilerlift'`, and the stable tag becomes `boilerlift:<stable-name>`. `N8N_URL` and `N8N_API_KEY` keep their names: they name the n8n instance, not the tool.

## Consequences

- Workflows that a previous version tagged `n8nlift:<stable-name>` are not migrated: `deploy` no longer finds them, so it creates them again with the new tag. Delete or archive the old copies in the n8n editor. The package had no public users yet, so a migration was not worth its cost.
- The `n8nlift` package is deprecated on npm and points to `boilerlift`.
