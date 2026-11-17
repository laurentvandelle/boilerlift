import { CliResult } from '#src/cli/cli.model';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { describeConfigError } from '#src/core/config/config-error';
import { ConfigError } from '#src/core/config/config.model';
import { DeployAction, DeployReport, DeployResult, DeployWarning } from '#src/core/deliver/deploy.model';
import { formatList } from '#src/core/deliver/format-list';
import { stableTag } from '#src/core/deliver/stable-tag';
import { EXIT_OK, EXIT_USAGE } from '#src/core/common/exit-codes';

/** How the report is printed: the --json and --dry-run flags. */
export interface DeployFormat {
  json: boolean;
  dryRun: boolean;
}

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
  command: 'lift deploy',
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
  command: 'lift deploy --dry-run',
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
    'Dry run: nothing was written. Run lift deploy to apply.',
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

/** A connection config that cannot be used: exit 1, the fix on stderr. */
export function renderConfigError(error: ConfigError): CliResult {
  return { exitCode: EXIT_USAGE, stdout: '', stderr: describeConfigError(error) };
}

/** Workflow files that do not load: exit 1, one line per problem on stderr. */
export function renderInvalidFiles(problems: LoadProblem[]): CliResult {
  const lines = problems.map((problem) => `✗ ${problem.path}  ${problem.detail}`);
  return {
    exitCode: EXIT_USAGE,
    stdout: '',
    stderr: `Invalid workflow files. Nothing was sent to n8n.\n${lines.join('\n')}\n`,
  };
}

/** No workflow file under `dir`: exit 0, nothing was sent. */
export function renderNothingToDeploy(dir: string, instance: string, format: DeployFormat): CliResult {
  return format.json
    ? renderJson(instance, { results: [], warnings: [], exitCode: EXIT_OK }, wordingOf(format))
    : { exitCode: EXIT_OK, stdout: `Nothing to deploy: no workflow in ./${dir}.\n`, stderr: '' };
}

/** The report of a deploy or a dry run, as text or JSON. */
export function renderReport(instance: string, report: DeployReport, format: DeployFormat): CliResult {
  const wording = wordingOf(format);
  return format.json ? renderJson(instance, report, wording) : renderText(instance, report, wording);
}

function wordingOf(format: DeployFormat): Wording {
  return format.dryRun ? DRY_RUN_WORDING : DEPLOY_WORDING;
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
