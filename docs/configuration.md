# Configure your targets

A **target** is one n8n instance Boilerlift deploys to, with the folder of workflow files it receives. Declare your targets in **`boilerlift.config.ts`** at the project root. Every command that talks to n8n reads it. Without it, the command stops, exits 1 and prints a starter config to copy (the `STARTER_CONFIG` of [`src/core/config/config-error.ts`](../src/core/config/config-error.ts)).

```ts
// boilerlift.config.ts
import { defineConfig } from 'boilerlift';

export default defineConfig({
  targets: {
    dev: {
      url: process.env.DEV_N8N_URL,
      apiKey: process.env.DEV_N8N_API_KEY,
      workflows: './workflows',
    },
    prod: {
      url: 'https://your-n8n.example.com',
      apiKey: process.env.PROD_N8N_API_KEY,
      workflows: './workflows',
      tag: false,
    },
  },
});
```

| Field       | Value |
| ----------- | ----- |
| key         | The target name: 1 to 24 lowercase letters, digits or dashes (24 is the longest tag name n8n takes). Targets are listed and run in the order you declare them. |
| `url`       | Root URL of the n8n instance, `http://` or `https://`. Boilerlift adds `/api/v1` itself. Write it, or read it from the environment. |
| `apiKey`    | The n8n API key (n8n → Settings → n8n API). Read it from an environment variable of your choice, such as `process.env.PROD_N8N_API_KEY`: never write the key itself in the file. |
| `workflows` | The folder of the workflow files for this target, from the project root. Always explicit. |
| `tag`       | Optional, `true` by default. `deploy` adds a tag named after the target (here `dev`) to every workflow it delivers, so you can see in n8n which target a workflow belongs to. Set `false` to turn it off. The tag is for display only: deploy never uses it to find your workflows. |

The types of the file are `defineConfig` and its config types, exported from `'boilerlift'` ([`src/index.ts`](../src/index.ts)).

## Environment variables

You choose the variable names. Before it loads `boilerlift.config.ts`, Boilerlift puts the variables of the `.env` file in the current folder into `process.env`. A variable already set in the environment wins over `.env`. A `url` or `apiKey` that reads an unset variable is reported as empty, naming the target.

```sh
# .env — keep it out of Git
DEV_N8N_URL=https://dev.your-n8n.example.com
DEV_N8N_API_KEY=your-dev-api-key
PROD_N8N_API_KEY=your-prod-api-key
```

## Choosing a target

With one target declared, `ping` and `deploy` run on it. With several, name one with `--target <name>` (`-t`), or run on every one in turn with `--all`. `lift help ping` and `lift help deploy` print the same rules.

Several targets and none named, an unknown name, or a target whose workflows folder does not exist stops the command before anything is sent, lists the available targets and exits 1. `--target` and `--all` together are a usage error.

Several targets may share a workflows folder (the same files to dev and prod), or share an instance with different folders. Two targets on the same instance whose folders hold the same stable name would overwrite each other's workflow: `deploy` refuses this before writing, naming both targets and the file.

## Upgrading from `N8N_URL`

Paste the starter config `lift ping` prints. It reads `url` from `process.env.N8N_URL` and `apiKey` from `process.env.N8N_API_KEY`, so your `.env` keeps working as it is.
