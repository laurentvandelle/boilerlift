import { CommandDefinition } from '#src/cli/cli.model';
import { renderConfigError, renderInvalidFiles, renderNothingToDeploy, renderReport } from '#src/cli/commands/deploy/deploy.render';
import { defineCommand } from '#src/cli/define-command';
import { loadWorkflows } from '#src/core/compile/load-workflows';
import { resolveConnectionConfig } from '#src/core/config/connection-config';
import { planToReport } from '#src/core/deliver/apply-plan';
import { deploy } from '#src/core/deliver/deploy';
import { planDeploy } from '#src/core/deliver/plan-deploy';
import { MIN_N8N_VERSION } from '#src/core/n8n/n8n-api';
import { createN8nClient } from '#src/services/n8n/n8n-client';

const WORKFLOWS_DIR = 'workflows';

const USAGE = `lift deploy [--dry-run] [--json]

Delivers every workflow under ./workflows (*.workflow.ts with a default export, or *.json),
pasted from an n8n export, to your n8n instance:
  new workflows are created (never published) and tagged boilerlift:<stable-name>,
  changed workflows are updated as drafts: the published version keeps running,
  unchanged workflows are skipped,
  workflows deleted (archived) in the n8n editor are restored as unpublished drafts.
The stable name is the file name without .workflow.ts / .json: 1 to 16 of a-z, 0-9 and -.

Nothing is written until the instance proves it saves drafts (n8n ${MIN_N8N_VERSION} or later).
A failure on one workflow fails only that workflow; the others are still delivered.
Reads N8N_URL and N8N_API_KEY like lift ping.

--dry-run reads the instance and shows what deploy would create, update, restore, skip or fail,
and any blocker, without writing anything. It exits with the same codes as a real deploy.

Exit codes:
  0  Every workflow delivered, or nothing to deploy
  1  Usage error, missing configuration or invalid workflow files
  3  The n8n instance cannot be reached
  4  The API key is rejected
  5  At least one workflow failed; the others were delivered
  6  The instance is older than n8n ${MIN_N8N_VERSION}: nothing was written`;

export const deployCommand: CommandDefinition = defineCommand({
  name: 'deploy',
  summary: 'Deliver your workflows to your n8n instance as drafts',
  usage: USAGE,
  allowPositionals: false,
  options: {
    'dry-run': { type: 'boolean', description: 'Show what deploy would do; write nothing' },
    json: { type: 'boolean', description: 'Print the report as JSON' },
  },
  run: async (input, ctx) => {
    const format = { json: input.options.flag('json'), dryRun: input.options.flag('dry-run') };
    const resolved = resolveConnectionConfig(ctx.env, ctx.dotEnv);
    if (!resolved.ok) {
      return renderConfigError(resolved.error);
    }
    const config = resolved.value;
    const loaded = loadWorkflows(await ctx.loadWorkflowFiles(WORKFLOWS_DIR));
    if (!loaded.ok) {
      return renderInvalidFiles(loaded.error);
    }
    const instance = config.url.value;
    const workflows = loaded.value;
    if (workflows.length === 0) {
      return renderNothingToDeploy(WORKFLOWS_DIR, instance, format);
    }
    const client = createN8nClient({ config, fetch: ctx.fetch });
    const deployInput = { workflows, client };
    const report = format.dryRun ? planToReport(await planDeploy(deployInput)) : await deploy(deployInput);
    return renderReport(instance, report, format);
  },
});
