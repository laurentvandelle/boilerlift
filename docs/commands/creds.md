# `lift creds sync`

Writes the credentials of the n8n instance of your target into your project, so a workflow picks a credential by its key with editor autocompletion. Then it tells you which credentials your workflows use that the target doesn't have. It reads the target and its API key from `boilerlift.config.ts` (see [Configure your targets](../configuration.md)).

```sh
lift creds sync              # the only target, or the one named with -t
lift creds sync -t prod      # the target named prod
lift creds sync --all        # every target, one after the other
lift creds sync --json       # the lists and the missing keys as JSON
```

`lift help creds sync` prints every option and the exit codes.

## The credentials file

Each target gets its own file, `credentials/<target>.ts`, next to `boilerlift.config.ts`. Commit it with the project. It lists the key, name, type and n8n id of each credential: never a secret. The sync only reads the instance (`GET /api/v1/credentials`), and the same credentials always give the same file, so a sync with nothing new leaves no diff.

The **key** is the credential name in kebab-case: `Gmail – Sales team` becomes `gmail-sales-team`. When several names give the same key, the oldest n8n id keeps it and the next ones get `-2`, `-3`…

- A credential recreated in n8n with the same name keeps its key; its new id is written.
- A credential renamed in n8n gets a new key. Workflows that use the old one are reported missing.
- A credential deleted in n8n leaves the list at the next sync.

## Pick a credential in a workflow

```ts
import { credential, defineWorkflow } from 'boilerlift';

export default defineWorkflow({
  name: 'Invoice sync',
  nodes: [
    {
      name: 'Send',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2,
      position: [0, 0],
      parameters: {},
      credentials: credential('gmail-sales-team'),
    },
  ],
  connections: {},
});
```

`credential()` takes the keys of every target's list, so the editor offers them and flags a key no list has. It returns the `credentials` entry of the node, under the type of its credential.

`lift deploy` does not resolve `credential()` yet: it refuses a workflow that uses it, before sending anything.

## Missing credentials

After writing the list, `creds sync` reads the workflows folder of the target and prints one line per key its workflows use that the list does not have:

```text
Synced 3 credentials from prod.
Wrote credentials/prod.ts.
Missing on prod: gmail-sales-team (gmailOAuth2), used by: invoice-sync, crm-import
```

The list is still written, and the command exits 8.

## When it fails

- The API key lacks the `credential:list` scope (n8n answers 403): exit 9. Give the key that scope in n8n → Settings → n8n API.
- The key is rejected (401) or the instance cannot be reached: exit 4 or 3. Run `lift ping` to check the target.
- The file cannot be written: exit 10.

In each case the file is left as it was.
