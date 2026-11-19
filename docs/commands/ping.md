# `lift ping`

Checks that your project can reach the n8n instance of your target, before you deploy anything. It reads the target and its API key from `boilerlift.config.ts` (see [Configure your targets](../configuration.md)).

```sh
lift ping              # the only target, or the one named with -t
lift ping -t prod      # the target named prod
lift ping --all        # every target, one after the other
lift ping --json       # the checks as JSON
```

`lift help ping` prints every option and the exit codes.

## What it checks

`ping` is read-only. It checks, in order:

1. that Node.js is recent enough (the `MIN_NODE_VERSION` of [`src/core/connection/check-connection.ts`](../../src/core/connection/check-connection.ts));
2. that the instance answers on `GET /healthz`;
3. that the public API accepts your key (`GET /api/v1/workflows`).

After a failed check the next ones are skipped, and each failure prints the next step. The key is never printed. An `http://` URL gets a warning, because the key travels unencrypted. With `--all`, each target gets its own block, then a recap line per target, and the exit code is the highest of them.

`ping` cannot check the n8n version: the n8n API doesn't expose it. `deploy` checks it before writing anything, from the API spec the instance serves.

## In a project script

```json
{
  "scripts": {
    "ping": "lift ping"
  }
}
```

Then run `npm run ping`.
