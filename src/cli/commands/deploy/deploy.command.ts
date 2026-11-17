import { CliResult, CommandDefinition } from '#src/cli/cli.model';
import { defineCommand } from '#src/cli/define-command';
import { loadWorkflows } from '#src/core/compile/load-workflows';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { resolveConnectionConfig } from '#src/core/config/connection-config';
import { describeConfigError } from '#src/core/config/config-error';
import { planToReport } from '#src/core/deliver/apply-plan';
import { deploy } from '#src/core/deliver/deploy';
import { DeployAction, DeployReport, DeployResult, DeployWarning } from '#src/core/deliver/deploy.model';
import { formatList } from '#src/core/deliver/format-list';
import { planDeploy } from '#src/core/deliver/plan-deploy';
import { stableTag } from '#src/core/deliver/stable-tag';
import { EXIT_OK, EXIT_USAGE } from '#src/core/common/exit-codes';
import { MIN_N8N_VERSION } from '#src/core/n8n/n8n-api';
import { createN8nClient } from '#src/services/n8n/n8n-client';

const WORKFLOWS_DIR = 'workflows';

const USAGE = `n8nlift deploy [--dry-run] [--json]

Delivers every workflow under ./workflows (*.workflow.ts with a default export, or *.json),
pasted from an n8n export, to your n8n instance:
  new workflows are created (never published) and tagged n8nlift:<stable-name>,
  changed workflows are updated as drafts: the published version keeps running,
  unchanged workflows are skipped,
  workflows deleted (archived) in the n8n editor are restored as unpublished drafts.
The stable name is the file name without .workflow.ts / .json: 1 to 16 of a-z, 0-9 and -.

Nothing is written until the instance proves it saves drafts (n8n ${MIN_N8N_VERSION} or later).
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
  6  The instance is older than n8n ${MIN_N8N_VERSION}: nothing was written`;

const MARKS: Record<DeployAction, string> = {
  created: '+',
  updated: '~',
  skipped: '=',
  restored: '!',
  failed: '✗',
  'not-processed': '-',
};

interface Summary {
  created: number;
  updated: number;
  restored: number;
  skipped: number;
  failed: number;
  notProcessed: number;
}

/** The words that differ between a deploy, which says what it did, and a dry run, which says what deploy would do. */
interface Wording {
  /** The value of --dry-run, which the JSON report echoes. */
  dryRun: boolean;
  /** The command in the first line of the text report. */
  command: string;
  /** What the result lines call each action. */
  labels: Record<DeployAction, string>;
  /** The lines under the results. */
  summary: (counts: Summary) => string[];
  /** How the stderr recap introduces the failed workflows. */
  failed: string;
  /** What each warning says deploy did, or would do. */
  outcomes: Record<DeployWarning['kind'], string>;
}

const DEPLOY_WORDING: Wording = {
  dryRun: false,
  command: 'n8nlift deploy',
  labels: {
    created: 'created',
    updated: 'updated',
    skipped: 'skipped',
    restored: 'restored',
    failed: 'failed',
    'not-processed': 'not-processed',
  },
  summary: ({ created, updated, restored, skipped, failed }) => {
    const drafts = created + updated + restored > 0 ? ' Drafts are not live until you publish them.' : '';
    return [`${created} created, ${updated} updated, ${restored} restored, ${skipped} skipped, ${failed} failed.${drafts}`];
  },
  failed: 'Failed',
  outcomes: { 'archived-copies': 'deploy used', restored: 'it is back', 'several-archived': 'deploy restored' },
};

const DRY_RUN_WORDING: Wording = {
  dryRun: true,
  command: 'n8nlift deploy --dry-run',
  labels: {
    created: 'would create',
    updated: 'would update',
    skipped: 'would skip',
    restored: 'would restore',
    failed: 'would fail',
    'not-processed': 'not processed',
  },
  summary: ({ created, updated, restored, skipped, failed }) => [
    `Would: ${created} create, ${updated} update, ${restored} restore, ${skipped} skip, ${failed} fail.`,
    'Dry run: nothing was written. Run n8nlift deploy to apply.',
    'n8n can still reject a write; this preview covers what reads can show.',
  ],
  failed: 'Would fail',
  outcomes: {
    'archived-copies': 'deploy would use',
    restored: 'deploy would bring it back',
    'several-archived': 'deploy would restore',
  },
};

const LABELS = [DEPLOY_WORDING, DRY_RUN_WORDING].flatMap(({ labels }) => Object.values(labels));
const ACTION_WIDTH = 1 + Math.max(...LABELS.map((label) => label.length));
const INDENT = ' '.repeat(2 + ACTION_WIDTH);

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
    const json = input.options.flag('json');
    const dryRun = input.options.flag('dry-run');
    const wording = dryRun ? DRY_RUN_WORDING : DEPLOY_WORDING;
    const resolved = resolveConnectionConfig(ctx.env, ctx.dotEnv);
    if (!resolved.ok) {
      return { exitCode: EXIT_USAGE, stdout: '', stderr: describeConfigError(resolved.error) };
    }
    const config = resolved.value;
    const loaded = loadWorkflows(await ctx.loadWorkflowFiles(WORKFLOWS_DIR));
    if (!loaded.ok) {
      return invalidFiles(loaded.error);
    }
    const instance = config.url.value;
    const workflows = loaded.value;
    if (workflows.length === 0) {
      return json
        ? renderJson(instance, { results: [], warnings: [], exitCode: EXIT_OK }, wording)
        : { exitCode: EXIT_OK, stdout: `Nothing to deploy: no workflow in ./${WORKFLOWS_DIR}.\n`, stderr: '' };
    }
    const client = createN8nClient({ config, fetch: ctx.fetch });
    const deployInput = { workflows, client };
    const report = dryRun ? planToReport(await planDeploy(deployInput)) : await deploy(deployInput);
    return json ? renderJson(instance, report, wording) : renderText(instance, report, wording);
  },
});

function invalidFiles(problems: LoadProblem[]): CliResult {
  const lines = problems.map((problem) => `✗ ${problem.path}  ${problem.detail}`);
  return {
    exitCode: EXIT_USAGE,
    stdout: '',
    stderr: `Invalid workflow files. Nothing was sent to n8n.\n${lines.join('\n')}\n`,
  };
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

function detailOf(result: DeployResult): string {
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
    return `${result.error.call} → ${result.error.detail}`;
  case 'not-processed':
    return 'not processed';
  }
}

/** One warning as a sentence. The --json report keeps the sentences. */
function warningText(warning: DeployWarning, wording: Wording): string {
  const { stableName } = warning;
  const outcome = wording.outcomes[warning.kind];
  switch (warning.kind) {
  case 'archived-copies': {
    const one = warning.archivedIds.length === 1;
    return `${stableName}: archived ${one ? 'workflow' : 'workflows'} ${formatList(warning.archivedIds)} still ${one ? 'carries' : 'carry'} the tag ${stableTag(stableName)}; ${outcome} the live workflow ${warning.liveId}`;
  }
  case 'restored':
    return `${stableName}: workflow ${warning.id} was archived in n8n; ${outcome} as an unpublished draft`;
  case 'several-archived':
    return `${stableName}: archived workflows ${formatList(warning.archivedIds)} all carry the tag ${stableTag(stableName)}; ${outcome} ${warning.restoredId}`;
  }
}

function renderText(instance: string, report: DeployReport, wording: Wording): CliResult {
  const width = Math.max(0, ...report.results.map((result) => result.stableName.length)) + 3;
  const stdout = [`${wording.command} → ${instance}`];
  for (const result of report.results) {
    stdout.push(`${MARKS[result.action]} ${wording.labels[result.action].padEnd(ACTION_WIDTH)}${result.stableName.padEnd(width)}${detailOf(result)}`);
    if (result.action === 'failed') {
      stdout.push(`${INDENT}→ ${result.error.hint}`);
    }
  }
  stdout.push(...report.warnings.map((warning) => `⚠ ${warningText(warning, wording)}`));
  const { error } = report;
  if (error !== undefined && report.results.length === 0) {
    const stderr = [`✗ ${error.call} → ${error.detail}`, `  → ${error.hint}`, 'Nothing was written to n8n.'];
    return { exitCode: report.exitCode, stdout: `${stdout.join('\n')}\n`, stderr: `${stderr.join('\n')}\n` };
  }
  stdout.push(...wording.summary(summarize(report.results)));
  return { exitCode: report.exitCode, stdout: `${stdout.join('\n')}\n`, stderr: recap(report, wording) };
}

/** The stderr recap: which workflows need attention and what to do next. Empty when everything went through. */
function recap(report: DeployReport, wording: Wording): string {
  const names = (action: DeployAction): string[] =>
    report.results.filter((result) => result.action === action).map((result) => result.stableName);
  const failedNames = names('failed');
  const notProcessed = names('not-processed');
  const lines: string[] = [];
  if (failedNames.length > 0) {
    lines.push(`${wording.failed}: ${failedNames.join(', ')}.`);
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

function renderJson(instance: string, report: DeployReport, wording: Wording): CliResult {
  const { error } = report;
  const payload = {
    instance,
    dryRun: wording.dryRun,
    results: report.results.map((result) => ({
      stableName: result.stableName,
      path: result.path,
      action: result.action,
      id: 'id' in result ? (result.id ?? null) : null,
      name: result.name,
      ...(result.action === 'failed' ? { error: result.error } : {}),
    })),
    summary: summarize(report.results),
    warnings: report.warnings.map((warning) => warningText(warning, wording)),
    error: error === undefined ? null : { call: error.call, detail: error.detail, hint: error.hint },
    exitCode: report.exitCode,
  };
  return { exitCode: report.exitCode, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: '' };
}
