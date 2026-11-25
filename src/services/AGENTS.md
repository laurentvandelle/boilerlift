# AGENTS.md — src/services

## Prohibitions

- Each folder imports only what its `boundaries/dependencies` policy in `eslint.config.mts` allows. Lint enforces all of these:
  - `http/` imports only `http/` and `core/common/`. It knows no service: no n8n path, header or body shape.
  - `n8n/` may import `n8n/`, `http/`, `core/n8n/`, `core/config/` and `core/common/`.
  - `fs/` may import `fs/`, `core/compile/`, `core/config/` and `core/common/`.
  - Only `cli/targets-need.ts` imports `n8n/`, for the commands that declare the `'targets'` need, and only `cli/node-context.ts` imports `fs/`. `core/`, the commands and the rest of `cli/` never do.
- `fetch` comes in as a parameter (`HttpOptions`, `N8nClientOptions`), never the global one. The I/O, time and randomness bans of `src/AGENTS.md` hold here too, but `fs/` may import `node:fs`. `fs/` still gets the environment and the prompt streams as parameters (`Environment`, `PromptStreams`): no `process`. Lint enforces it.
- A new folder needs its own element and policy in `eslint.config.mts`, and its type in `SERVICES`.

## Shape

- A service implements a port declared in `core/`. The port's types stay in `core/`; only what carries I/O (`fetch`, the options) lives here.
- `http/http.ts` is the one place that calls `fetch`: `getRequest`, `postRequest`, `putRequest` and `deleteRequest` take the URL, the headers, the JSON body to send, and a `response` reader (`jsonBody(parser)` or `textBody`). They return the read body, an `http-error` with the `message` of a JSON error body, an `invalid-response` when the reader rejects the body, or `unreachable` with a reason a person can act on.
- `fs/project-files.ts` holds the file adapters behind the file fields of `CommandContext` (`loadProjectConfig`, `loadWorkflowFiles`, `readLockFile`, `createFile`, `ask`…). They take absolute paths, or `cwd` where they return paths relative to it; `cli/node-context.ts` resolves the rest. They return the file shapes of `core/` (`WorkflowFile`, `CredentialsFile`, `ProjectConfigFile`, `TemplateFile`, `FileCreation`).
- `n8n/n8n-client.ts` implements `N8nClient` by calling those methods directly, one per endpoint: the URLs, the API key header, paging, and one parser of `n8n/n8n-response.ts` per body. Add no request wrapper between the client and `http/`. Why: `docs/adr/0007-adapters-live-in-services.md`.

## Tests

- Each adapter is tested with a hand-written `fetch` stub in its own test, which records the calls. `http/http.test.ts` pins the transport (methods, headers, body, readers, error messages, timeout, network errors); `n8n/n8n-client.test.ts` pins the n8n calls (URLs, API key, paging, parsers). `fs/project-files.test.ts` runs the file adapters on a temp folder.

## Example

- `src/services/http/http.ts` and `src/services/http/http.test.ts`
