# Workflow files are typed n8n exports, and compile only validates them

A workflow file holds an n8n export, pasted from the editor's download, either as a `.json` file or passed to `defineWorkflow` in a `.workflow.ts` file. `defineWorkflow` returns the export unchanged: its types let the editor flag a missing node field, a connection to a node that does not exist and a node name used twice. `compile/` generates nothing. Before deploy, its loader runs the same checks on every file, `.json` included, and the package entry point (`src/index.ts`) exports `defineWorkflow` and the workflow types for workflow files to import as `'boilerlift'`. The export is what n8n reads and writes, so a workflow goes from the editor to Git and back without a translation step that could lose fields or lag behind new n8n nodes.

## Considered options

- Node factories that build the n8n JSON from TypeScript calls: Boilerlift would have to model every n8n node and follow each n8n release, and an editor export could not be pasted in. Dropped with the `sdk/` layer in ADR 0001.
- Plain `.json` exports only: no editor feedback before deploy, and no TypeScript to lint, type-check and test in CI. `.json` files stay accepted next to `.workflow.ts` files.

## Consequences

- `defineWorkflow` and the workflow types are public API of the npm package: changing them breaks users' workflow files.
- ADR 0001 says the CLI compiles TypeScript into n8n JSON and that `src/index.ts` exports nothing. This ADR replaces both statements.
