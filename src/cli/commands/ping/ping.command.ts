import { CommandDefinition } from '#src/cli/cli.model';
import { renderConfigError, renderReport } from '#src/cli/commands/ping/ping.render';
import { defineCommand } from '#src/cli/define-command';
import { resolveConnectionConfig } from '#src/core/config/connection-config';
import { MIN_NODE_VERSION_SHORT, checkConnection } from '#src/core/connection/check-connection';
import { API_PATH } from '#src/core/n8n/n8n-api';
import { createN8nClient } from '#src/services/n8n/n8n-client';

const USAGE = `n8nlift ping

Reads N8N_URL and N8N_API_KEY from the environment, then from ./.env.
A variable set in the environment wins over .env.
  N8N_URL      Root URL of your n8n instance (n8nlift adds ${API_PATH})
  N8N_API_KEY  n8n API key (n8n → Settings → n8n API)

Exit codes:
  0  Every check passed
  1  Usage error or missing configuration
  2  Node.js is older than ${MIN_NODE_VERSION_SHORT}
  3  The n8n instance or its public API cannot be reached
  4  The API key is rejected`;

export const pingCommand: CommandDefinition = defineCommand({
  name: 'ping',
  summary: 'Check the connection to your n8n instance',
  usage: USAGE,
  allowPositionals: false,
  options: {},
  run: async (_input, ctx) => {
    const resolved = resolveConnectionConfig(ctx.env, ctx.dotEnv);
    if (!resolved.ok) {
      return renderConfigError(resolved.error);
    }
    const config = resolved.value;
    const client = createN8nClient({ config, fetch: ctx.fetch });
    const report = await checkConnection({ nodeVersion: ctx.nodeVersion, config, client });
    return renderReport(config, report);
  },
});
