# Adapters to the outside world live in src/services

`core/` declares what it needs from the outside world as ports (`N8nClient` in `core/n8n/n8n.model.ts`) and holds no adapter. The adapters that implement them live in a third layer, `src/services/`: `http/` is a generic HTTP transport that knows no service, and `n8n/` implements `N8nClient` over it. The direction is `cli` → `services` → `core`, and only the commands import `services/`, building the client from the injected `ctx.fetch`. `fetch` stays a parameter, so every layer stays testable with fakes, and lint enforces the directions with `eslint-plugin-boundaries`.

## Considered options

- Keep the client in `core/n8n/`: one fewer layer, but `core/` then mixes domain rules with transport details, and a second service would add more I/O there.
- `src/core/services/`: a smaller lint change, but it hides the layer inside `core/` and blurs the rule that `core/` holds no adapter.
- Let services use the global `fetch`: drops `ctx.fetch`, but tests would have to stub a global, which `docs/testing.md` rules out.
