import { CliResult, CommandDefinition } from '#src/cli/cli.model';
import { loadWorkflows } from '#src/core/compile/load-workflows';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { resolveConnectionConfig } from '#src/core/config/connection-config';
import { EXIT_MISSING_CONFIG, describeMissingConfig } from '#src/core/config/missing-config';
import { deploy, planDeploy, planToReport } from '#src/core/deliver/deploy';
import { DeployAction, DeployReport, DeployResult } from '#src/core/deliver/deploy.model';
import { createN8nClient } from '#src/core/n8n/n8n-client';

const WORKFLOWS_DIR = 'workflows';
const EXIT_INVALID_FILES = 1;

const USAGE = `n8nlift deploy [--dry-run] [--json]

Delivers every workflow under ./workflows (*.workflow.ts with a default export, or *.json),
pasted from an n8n export, to your n8n instance:
  new workflows are created (never published) and tagged n8nlift:<stable-name>,
  changed workflows are updated as drafts: the published version keeps running,
  unchanged workflows are skipped,
  workflows deleted (archived) in the n8n editor are restored as unpublished drafts.
The stable name is the file name without .workflow.ts / .json: 1 to 16 of a-z, 0-9 and -.

Nothing is written until the instance proves it saves drafts (n8n 2.35.0 or later).
A failure on one workflow fails only that workflow; the others are still delivered.
Reads N8N_URL and N8N_API_KEY like n8nlift ping.

--dry-run reads the instance and shows what deploy would create, update, restore, skip or fail,
and any blocker, without writing anything. It exits with the same codes as a real deploy.

Exit codes:
  0  Every workflow delivered, or nothing to deploy
  1  Usage error, missing configuration or invalid workflow files
  3  The n8n instance cannot be reached
  4  The API key is rejected
  5  At least one workflow failed; the others were delivered
  6  The instance is older than n8n 2.35.0: nothing was written`;

const MARKS: Record<DeployAction, string> = {
  created: '+',
  updated: '~',
  skipped: '=',
  restored: '!',
  failed: '✗',
  'not-processed': '-',
};

/** What a dry run calls each action. */
const DRY_RUN_LABELS: Record<DeployAction, string> = {
  created: 'would create',
  updated: 'would update',
  skipped: 'would skip',
  restored: 'would restore',
  failed: 'would fail',
  'not-processed': 'not processed',
};

/** The longest label, `not-processed` or `would restore`, plus one space. */
const ACTION_WIDTH = 1 + Math.max(...Object.keys(MARKS).map((action) => action.length), ...Object.values(DRY_RUN_LABELS).map((label) => label.length));
const INDENT = ' '.repeat(2 + ACTION_WIDTH);

export const deployCommand: CommandDefinition = {
  name: 'deploy',
  summary: 'Deliver your workflows to your n8n instance as drafts',
  usage: USAGE,
  allowPositionals: false,
  options: {
    'dry-run': { type: 'boolean', description: 'Show what deploy would do; write nothing' },
    json: { type: 'boolean', description: 'Print the report as JSON' },
  },
  run: async (input, ctx) => {
    const json = input.values.json === true;
    const dryRun = input.values['dry-run'] === true;
    const resolved = resolveConnectionConfig(ctx.env, ctx.dotEnv);
    if (!resolved.ok) {
      return { exitCode: EXIT_MISSING_CONFIG, stdout: '', stderr: describeMissingConfig(resolved.missing) };
    }
    const { config } = resolved;
    const loaded = loadWorkflows(await ctx.loadWorkflowFiles(WORKFLOWS_DIR));
    if (!loaded.ok) {
      return invalidFiles(loaded.problems);
    }
    const instance = config.url.value;
    if (loaded.workflows.length === 0) {
      return json
        ? renderJson(instance, { results: [], warnings: [], exitCode: 0 }, dryRun)
        : { exitCode: 0, stdout: `Nothing to deploy: no workflow in ./${WORKFLOWS_DIR}.\n`, stderr: '' };
    }
    const client = createN8nClient({ baseUrl: instance, apiKey: config.apiKey.value, fetch: ctx.fetch });
    const deployInput = { workflows: loaded.workflows, client };
    const report = dryRun ? planToReport(await planDeploy(deployInput)) : await deploy(deployInput);
    return json ? renderJson(instance, report, dryRun) : renderText(instance, report, dryRun);
  },
};

function invalidFiles(problems: LoadProblem[]): CliResult {
  const lines = problems.map((problem) => `✗ ${problem.path}  ${problem.detail}`);
  return {
    exitCode: EXIT_INVALID_FILES,
    stdout: '',
    stderr: `Invalid workflow files. Nothing was sent to n8n.\n${lines.join('\n')}\n`,
  };
}

interface Summary {
  created: number;
  updated: number;
  restored: number;
  skipped: number;
  failed: number;
  notProcessed: number;
}

function summarize(results: DeployResult[]): Summary {
  const count = (action: DeployAction): number => results.filter((result) => result.action === action).length;
  return {
    created: count('created'),
    updated: count('updated'),
    restored: count('restored'),
    skipped: count('skipped'),
    failed: count('failed'),
    notProcessed: count('not-processed'),
  };
}

function describe(result: DeployResult): string {
  switch (result.action) {
  case 'created':
    return result.path;
  case 'updated':
    return `${result.path} (draft; published version still running)`;
  case 'restored':
    return `${result.path} (unpublished draft)`;
  case 'skipped':
    return 'unchanged';
  case 'failed':
    return result.error === undefined ? 'failed' : `${result.error.call} → ${result.error.detail}`;
  case 'not-processed':
    return 'not processed';
  }
}

function renderText(instance: string, report: DeployReport, dryRun: boolean): CliResult {
  const width = Math.max(0, ...report.results.map((result) => result.stableName.length)) + 3;
  const stdout = [`n8nlift deploy${dryRun ? ' --dry-run' : ''} → ${instance}`];
  for (const result of report.results) {
    const label = dryRun ? DRY_RUN_LABELS[result.action] : result.action;
    stdout.push(`${MARKS[result.action]} ${label.padEnd(ACTION_WIDTH)}${result.stableName.padEnd(width)}${describe(result)}`);
    if (result.error !== undefined) {
      stdout.push(`${INDENT}→ ${result.error.hint}`);
    }
  }
  stdout.push(...report.warnings.map((warning) => `⚠ ${warning}`));
  const { error } = report;
  if (error !== undefined && report.results.length === 0) {
    const stderr = [`✗ ${error.call} → ${error.detail}`, `  → ${error.hint}`, 'Nothing was written to n8n.'];
    return { exitCode: report.exitCode, stdout: `${stdout.join('\n')}\n`, stderr: `${stderr.join('\n')}\n` };
  }
  const summary = summarize(report.results);
  const { created, updated, restored, skipped, failed } = summary;
  if (dryRun) {
    stdout.push(
      `Would: ${created} create, ${updated} update, ${restored} restore, ${skipped} skip, ${failed} fail.`,
      'Dry run: nothing was written. Run n8nlift deploy to apply.',
      'n8n can still reject a write; this preview covers what reads can show.',
    );
  } else {
    const drafts = created + updated + restored > 0 ? ' Drafts are not live until you publish them.' : '';
    stdout.push(`${created} created, ${updated} updated, ${restored} restored, ${skipped} skipped, ${failed} failed.${drafts}`);
  }
  return { exitCode: report.exitCode, stdout: `${stdout.join('\n')}\n`, stderr: recap(report, dryRun) };
}

/** The stderr recap: which workflows need attention and what to do next. Empty when everything went through. */
function recap(report: DeployReport, dryRun: boolean): string {
  const names = (action: DeployAction): string[] =>
    report.results.filter((result) => result.action === action).map((result) => result.stableName);
  const failedNames = names('failed');
  const notProcessed = names('not-processed');
  const lines: string[] = [];
  if (failedNames.length > 0) {
    lines.push(`${dryRun ? 'Would fail' : 'Failed'}: ${failedNames.join(', ')}.`);
  }
  if (report.error !== undefined) {
    lines.push(`Stopped: ${report.error.call} → ${report.error.detail}`);
    if (notProcessed.length > 0) {
      lines.push(`Not processed: ${notProcessed.join(', ')}.`);
    }
    lines.push(`Next: ${report.error.hint}.`);
  } else if (failedNames.length > 0) {
    lines.push('Next: fix each failure with the hint under its line, then run deploy again.');
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function renderJson(instance: string, report: DeployReport, dryRun: boolean): CliResult {
  const { error } = report;
  const payload = {
    instance,
    dryRun,
    results: report.results.map(({ stableName, path, action, id, name, error: failure }) => ({
      stableName,
      path,
      action,
      id: id ?? null,
      name,
      ...(failure === undefined ? {} : { error: failure }),
    })),
    summary: summarize(report.results),
    warnings: report.warnings,
    error: error === undefined ? null : { call: error.call, detail: error.detail, hint: error.hint },
    exitCode: report.exitCode,
  };
  return { exitCode: report.exitCode, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: '' };
}
