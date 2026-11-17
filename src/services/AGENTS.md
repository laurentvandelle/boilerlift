# AGENTS.md — src/services

## Prohibitions

- Each folder imports only what its `boundaries/dependencies` policy in `eslint.config.mts` allows. Lint enforces all of these:
  - `http/` imports only `http/` and `core/common/`. It knows no service: no n8n path, header or body shape.
  - `n8n/` may import `n8n/`, `http/`, `core/n8n/`, `core/config/` and `core/common/`.
  - Only `cli/commands/` import `services/`. `core/` and the rest of `cli/` never do.
- `fetch` comes in as a parameter (`HttpOptions`, `N8nClientOptions`), never the global one. The I/O, time and randomness bans of `src/AGENTS.md` hold here too. Lint enforces it.
- A new folder needs its own element and policy in `eslint.config.mts`, and its type in `SERVICES`.

## Shape

- A service implements a port declared in `core/`. The port's types stay in `core/`; only what carries I/O (`fetch`, the options) lives here.
- `http/http.ts` sends one request and returns the body as text: a success status, an `http-error` with the body, or `unreachable` with a reason a person can act on.
- `n8n/n8n-client.ts` implements `N8nClient` over `http/`: the API key, the paths and paging, the n8n error `message`, and the JSON parse. It runs every body through one parser of `n8n/n8n-response.ts`; a mismatch is an `invalid-response` failure. Why: `docs/adr/0007-adapters-live-in-services.md`.

## Tests

- Each adapter is tested with a hand-written `fetch` stub in its own test, which records the calls. `http/http.test.ts` pins the transport (headers, body, timeout, network errors); `n8n/n8n-client.test.ts` pins the n8n calls (paths, API key, paging, parsing, error messages).

## Example

- `src/services/http/http.ts` and `src/services/http/http.test.ts`
