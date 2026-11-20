import { CliResult } from '#src/cli/cli.model';
import { TargetRun } from '#src/cli/targets.render';
import { CredentialUse } from '#src/core/compile/credential.model';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { CONFIG_FILE } from '#src/core/config/project-config';
import { DeployAction, DeployReport, DeployResult, DeployWarning } from '#src/core/deliver/deploy.model';
import { LOCK_FILE } from '#src/core/deliver/lock-file';
import { LockFileError } from '#src/core/deliver/lock-file.model';
import { SharedEntry } from '#src/core/deliver/shared-entries';
import { EXIT_OK, EXIT_USAGE } from '#src/core/common/exit-codes';

/** How the report is worded: the --dry-run flag, and whether the command line named targets (`-t` or `--all`). */
export interface DeployFormat {
  dryRun: boolean;
  named: boolean;
}

/** The target a deploy runs on: its name, and its url, the instance the lock file records under. */
export interface DeployTarget {
  name: string;
  instance: string;
}

const MARKS: Record<DeployAction, string> = {
  created: '+',
  recreated: '*',
  updated: '~',
  skipped: '=',
  restored: '!',
  failed: '✗',
  'not-processed': '-',
};

interface Summary {
  created: number;
  recreated: number;
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
  /** The lines under the results. `publish` is the command that publishes the drafts. */
  summary: (counts: Summary, publish: string) => string[];
  /** How the stderr recap introduces the failed workflows. */
  failed: string;
  /** What each warning says deploy did, or would do. */
  outcomes: Record<DeployWarning['kind'], string>;
  /** The line that tells the user to commit the lock file, when it changed or would change. */
  lockFile: string;
  /** The line under the summary when the target tag went, or would go, on `added` workflows. */
  tag: (name: string, added: number) => string;
}

const DEPLOY_WORDING: Wording = {
  dryRun: false,
  command: 'lift deploy',
  labels: {
    created: 'created',
    recreated: 'recreated',
    updated: 'updated',
    skipped: 'skipped',
    restored: 'restored',
    failed: 'failed',
    'not-processed': 'not-processed',
  },
  summary: (counts, publish) => {
    const { created, recreated, updated, restored, skipped, failed } = counts;
    const drafts = deliveredDrafts(counts) ? ` Run ${publish} to publish the drafts.` : '';
    const recreatedCount = recreated > 0 ? `${recreated} recreated, ` : '';
    return [`${created} created, ${recreatedCount}${updated} updated, ${restored} restored, ${skipped} skipped, ${failed} failed.${drafts}`];
  },
  failed: 'Failed',
  outcomes: { restored: 'it is back', 'tag-failed': 'the workflow is deployed without it' },
  lockFile: `${LOCK_FILE} updated — commit it`,
  tag: (name, added) => `Tag ${name} added to ${added} workflows`,
};

const DRY_RUN_WORDING: Wording = {
  dryRun: true,
  command: 'lift deploy --dry-run',
  labels: {
    created: 'would create',
    recreated: 'would recreate',
    updated: 'would update',
    skipped: 'would skip',
    restored: 'would restore',
    failed: 'would fail',
    'not-processed': 'not processed',
  },
  summary: ({ created, recreated, updated, restored, skipped, failed }) => [
    `Would: ${created} create, ${recreated > 0 ? `${recreated} recreate, ` : ''}${updated} update, ${restored} restore, ${skipped} skip, ${failed} fail.`,
    'Dry run: nothing was written. Run lift deploy to apply.',
    'n8n can still reject a write; this preview covers what reads can show.',
  ],
  failed: 'Would fail',
  outcomes: { restored: 'deploy would bring it back', 'tag-failed': 'the workflow would be deployed without it' },
  lockFile: `${LOCK_FILE} would update — commit it after lift deploy`,
  tag: (name, added) => `Tag ${name} would be added to ${added} workflows`,
};

/** True when the deploy delivered at least one draft: created, recreated, updated or restored. */
function deliveredDrafts({ created, recreated, updated, restored }: Summary): boolean {
  return created + recreated + updated + restored > 0;
}

/** The command that publishes the drafts, with `--target <name>` when the command line named targets. */
function publishCommand(target: DeployTarget, format: DeployFormat): string {
  return format.named ? `lift publish --target ${target.name}` : 'lift publish';
}

const LABELS = [DEPLOY_WORDING, DRY_RUN_WORDING].flatMap(({ labels }) => Object.values(labels));
const ACTION_WIDTH = 1 + Math.max(...LABELS.map((label) => label.length));
const INDENT = ' '.repeat(2 + ACTION_WIDTH);

/**
 * Targets on one instance whose folders hold the same stable name: exit 1, nothing was sent. With --json, the error
 * on stdout too.
 */
export function renderSharedEntries(shared: SharedEntry[], format: { json: boolean }): CliResult {
  const lines = shared.map(
    ({ stableName, instance, first, second }) =>
      `✗ ${stableName}  targets ${first.target} (${first.path}) and ${second.target} (${second.path}) both deploy it to ${instance}`,
  );
  const message = [
    'Targets share a workflow on the same instance. Nothing was sent to n8n.',
    ...lines,
    `  → Both would use one entry of ${LOCK_FILE} and overwrite each other. Rename one of the files, or point the targets at different instances in ${CONFIG_FILE}.`,
  ].join('\n');
  if (!format.json) {
    return { exitCode: EXIT_USAGE, stdout: '', stderr: `${message}\n` };
  }
  const payload = { error: { kind: 'shared-lock-entry', message }, exitCode: EXIT_USAGE };
  return { exitCode: EXIT_USAGE, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: `${message}\n` };
}

/** Nodes that pick a credential with credential(), which deploy cannot resolve yet: exit 1, nothing sent. */
export function renderCredentialMarkers(uses: CredentialUse[], format: { json: boolean }): CliResult {
  const lines = uses.map(({ path, node, key }) => `✗ ${path}  node "${node}" uses credential('${key}')`);
  const message = [
    "Workflows pick credentials with credential(), which deploy cannot resolve yet. Nothing was sent to n8n.",
    ...lines,
    '  → Until deploy resolves it, set the credentials of these nodes as n8n exports them: { "<type>": { "id": "…", "name": "…" } }.',
  ].join('\n');
  if (!format.json) {
    return { exitCode: EXIT_USAGE, stdout: '', stderr: `${message}\n` };
  }
  const payload = {
    error: { kind: 'credential-not-deployable', message, uses: uses.map(({ path, node, key }) => ({ path, node, key })) },
    exitCode: EXIT_USAGE,
  };
  return { exitCode: EXIT_USAGE, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: `${message}\n` };
}

/** Workflow files that do not load: exit 1, one line per problem on stderr. */
export function renderInvalidFiles(target: DeployTarget, problems: LoadProblem[]): TargetRun {
  const lines = problems.map((problem) => `✗ ${problem.path}  ${problem.detail}`);
  const message = 'Invalid workflow files. Nothing was sent to n8n.';
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_USAGE, stdout: '', stderr: `${message}\n${lines.join('\n')}\n` },
    payload: {
      instance: target.instance,
      error: { kind: 'invalid-files', message, problems: problems.map(({ path, detail }) => ({ path, detail })) },
      exitCode: EXIT_USAGE,
    },
    outcome: 'invalid workflow files, nothing sent',
  };
}

/** A lock file that cannot be read: exit 1, nothing was sent, the problem and the fix on stderr. */
export function renderInvalidLockFile(target: DeployTarget, error: LockFileError): TargetRun {
  const message = `Invalid ${LOCK_FILE}. Nothing was sent to n8n.`;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: `${message}\n✗ ${LOCK_FILE}  ${error.detail}\n  → Fix the file, or restore it from version control, then run deploy again.\n`,
    },
    payload: { instance: target.instance, error: { kind: 'invalid-lock-file', message, detail: error.detail }, exitCode: EXIT_USAGE },
    outcome: `invalid ${LOCK_FILE}, nothing sent`,
  };
}

/** No workflow file under `dir`: exit 0, nothing was sent. */
export function renderNothingToDeploy(target: DeployTarget, dir: string, format: DeployFormat): TargetRun {
  const report: DeployReport = { results: [], warnings: [], lockFile: { path: LOCK_FILE, changed: false }, exitCode: EXIT_OK };
  const message = `Nothing to deploy: no workflow in ${dir}.`;
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_OK, stdout: `${message}\n`, stderr: '' },
    payload: jsonPayload(target, report, wordingOf(format), format),
    outcome: message,
  };
}

/** The report of a deploy or a dry run on one target: its text, its JSON payload and its recap. */
export function renderReport(target: DeployTarget, report: DeployReport, format: DeployFormat): TargetRun {
  const wording = wordingOf(format);
  const [summary = ''] = wording.summary(summarize(report.results), publishCommand(target, format));
  const outcome =
    report.error !== undefined && report.results.length === 0
      ? `stopped: ${report.error.call} → ${report.error.detail}`
      : report.error !== undefined
        ? `stopped: ${report.error.call} → ${report.error.detail}; ${summary}`
        : summary;
  return {
    target: target.name,
    url: target.instance,
    text: renderText(target, report, wording, format),
    payload: jsonPayload(target, report, wording, format),
    outcome,
  };
}

function wordingOf(format: DeployFormat): Wording {
  return format.dryRun ? DRY_RUN_WORDING : DEPLOY_WORDING;
}

function summarize(results: DeployResult[]): Summary {
  const count = (action: DeployAction): number => results.filter((result) => result.action === action).length;
  return {
    created: count('created'),
    recreated: count('recreated'),
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
  case 'recreated':
    return `${result.path} (n8n no longer has the recorded workflow ${result.previousId})`;
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
  case 'restored':
    return `${stableName}: workflow ${warning.id} was archived in n8n; ${outcome} as an unpublished draft`;
  case 'tag-failed':
    return `${stableName}: tag ${warning.tag} not added (${warning.call} → ${warning.detail}); ${outcome}`;
  }
}

function renderText(target: DeployTarget, report: DeployReport, wording: Wording, format: DeployFormat): CliResult {
  const width = Math.max(0, ...report.results.map((result) => result.stableName.length)) + 3;
  const stdout = [`${wording.command} → ${target.name} (${target.instance})`];
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
  const [summary = '', ...notes] = wording.summary(summarize(report.results), publishCommand(target, format));
  stdout.push(summary);
  if (report.tag !== undefined && report.tag.added > 0) {
    stdout.push(wording.tag(report.tag.name, report.tag.added));
  }
  stdout.push(...notes);
  if (report.lockFile.changed) {
    stdout.push(wording.lockFile);
  }
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

/** The --json report. `next` is the publish command when the deploy delivered drafts, or null. */
function jsonPayload(target: DeployTarget, report: DeployReport, wording: Wording, format: DeployFormat): Record<string, unknown> {
  const { error } = report;
  const summary = summarize(report.results);
  return {
    instance: target.instance,
    dryRun: wording.dryRun,
    results: report.results.map((result) => ({
      stableName: result.stableName,
      path: result.path,
      action: result.action,
      id: 'id' in result ? (result.id ?? null) : null,
      ...(result.action === 'recreated' ? { previousId: result.previousId } : {}),
      name: result.name,
      ...(result.action === 'failed' ? { error: result.error } : {}),
    })),
    summary,
    warnings: report.warnings.map((warning) => warningText(warning, wording)),
    lockFile: report.lockFile,
    tag: report.tag ?? null,
    error: error === undefined ? null : { call: error.call, detail: error.detail, hint: error.hint },
    next: !wording.dryRun && deliveredDrafts(summary) ? publishCommand(target, format) : null,
    exitCode: report.exitCode,
  };
}
