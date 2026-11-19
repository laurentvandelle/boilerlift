import { CommandDefinition } from '#src/cli/cli.model';
import { renderTargetReport } from '#src/cli/commands/ping/ping.render';
import { defineCommand } from '#src/cli/define-command';
import { renderTargets } from '#src/cli/targets.render';
import {
  EXIT_API_KEY_REJECTED,
  EXIT_NODE_TOO_OLD,
  EXIT_OK,
  EXIT_UNREACHABLE,
  EXIT_USAGE,
} from '#src/core/common/exit-codes';
import { CONFIG_FILE } from '#src/core/config/project-config';
import { MIN_NODE_VERSION_SHORT, checkConnection } from '#src/core/connection/check-connection';

export const pingCommand: CommandDefinition = defineCommand({
  name: 'ping',
  summary: 'Check the connection to your n8n instance',
  help: {
    description: `Checks the connection to the n8n instance of each target it runs on: Node.js, the instance,
its public API and the API key.`,
    exitCodes: [
      [EXIT_OK, 'Every check passed'],
      [EXIT_USAGE, `Usage error, missing or invalid ${CONFIG_FILE}, unknown target or missing API key`],
      [EXIT_NODE_TOO_OLD, `Node.js is older than ${MIN_NODE_VERSION_SHORT}`],
      [EXIT_UNREACHABLE, 'The n8n instance or its public API cannot be reached'],
      [EXIT_API_KEY_REJECTED, 'The API key is rejected'],
    ],
  },
  allowPositionals: false,
  options: {
    json: { type: 'boolean', description: 'Print the report as JSON', format: true },
  },
  needs: ['targets', 'nodeVersion'],
  modes: {},
  default: async (_prepared, { targets, nodeVersion }) => {
    const runs = [];
    for (const target of targets.selected) {
      const report = await checkConnection({ nodeVersion, config: target.connection, client: target.client });
      runs.push(renderTargetReport(target, report));
    }
    return runs;
  },
  render: (runs, { format, target }) => renderTargets(runs, { json: format.json, all: target.kind === 'all' }),
});
