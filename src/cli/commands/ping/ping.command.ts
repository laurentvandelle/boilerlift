import { CommandDefinition } from '#src/cli/cli.model';
import { renderTargetReport } from '#src/cli/commands/ping/ping.render';
import { defineCommand } from '#src/cli/define-command';
import { TargetRun, renderConfigError, renderTargets } from '#src/cli/targets.render';
import { CONFIG_FILE, targetsToRun } from '#src/core/config/project-config';
import { MIN_NODE_VERSION_SHORT, checkConnection } from '#src/core/connection/check-connection';
import { API_PATH } from '#src/core/n8n/n8n-api';
import { createN8nClient } from '#src/services/n8n/n8n-client';

const USAGE = `lift ping [--target <name> | --all] [--json]

Checks the connection to the n8n instance of a target declared in ./${CONFIG_FILE}:
  url     Root URL of the n8n instance (Boilerlift adds ${API_PATH})
  apiKey  Its n8n API key (n8n → Settings → n8n API). Read it from the environment in the
          file, for example process.env.N8N_API_KEY: the variables of ./.env are loaded
          first, and a variable already set in the environment wins.
With one target declared, ping runs on it. With several, name one with --target, or
check every one in turn with --all.

Exit codes:
  0  Every check passed
  1  Usage error, missing or invalid ${CONFIG_FILE}, unknown target or missing API key
  2  Node.js is older than ${MIN_NODE_VERSION_SHORT}
  3  The n8n instance or its public API cannot be reached
  4  The API key is rejected
With --all, the exit code is the highest of the targets.`;

export const pingCommand: CommandDefinition = defineCommand({
  name: 'ping',
  summary: 'Check the connection to your n8n instance',
  usage: USAGE,
  allowPositionals: false,
  targets: true,
  options: {
    json: { type: 'boolean', description: 'Print the report as JSON' },
  },
  run: async (input, ctx) => {
    const format = { json: input.options.flag('json'), all: input.target.kind === 'all' };
    const resolved = targetsToRun(await ctx.loadProjectConfig(), input.target);
    if (!resolved.ok) {
      return renderConfigError(resolved.error, format);
    }
    const runs: TargetRun[] = [];
    for (const target of resolved.value.targets) {
      const client = createN8nClient({ config: target.connection, fetch: ctx.fetch });
      const report = await checkConnection({ nodeVersion: ctx.nodeVersion, config: target.connection, client });
      runs.push(renderTargetReport(target, report));
    }
    return renderTargets(runs, format);
  },
});
