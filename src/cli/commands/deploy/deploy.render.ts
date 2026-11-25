import { CliResult } from '#src/cli/cli.model';
import { Row, SYMBOLS, cause, header, next, rows, sections, stopped, warning } from '#src/cli/output.render';
import { TargetRun } from '#src/cli/targets.render';
import { credentialsFilePath } from '#src/core/compile/credential-lists';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { CONFIG_FILE } from '#src/core/config/project-config';
import { TargetDelivery } from '#src/core/deliver/deliver.model';
import { DeployAction, DeployError, DeployReport, DeployResult, DeployWarning, UnresolvedCredential } from '#src/core/deliver/deploy.model';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { LockFileError } from '#src/core/lock/lock-file.model';
import { SharedEntry } from '#src/core/deliver/shared-entries';
import { workflowLink } from '#src/core/n8n/n8n-api';
import { EXIT_OK, EXIT_USAGE } from '#src/cli/exit-codes';

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

const SYMBOL_OF: Record<DeployAction, Row['symbol']> = {
  created: SYMBOLS.created,
  recreated: SYMBOLS.recreated,
  updated: SYMBOLS.updated,
  skipped: SYMBOLS.unchanged,
  restored: SYMBOLS.restored,
  failed: SYMBOLS.failed,
  'not-processed': SYMBOLS.skipped,
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
  /** The lines under the results. */
  summary: (counts: Summary) => string[];
  /** The next steps after the summary. `publish` is the command that publishes the drafts. */
  next: (counts: Summary, publish: string) => string[];
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
    'not-processed': 'not processed',
  },
  summary: ({ created, recreated, updated, restored, skipped, failed }) => {
    const recreatedCount = recreated > 0 ? `${recreated} recreated, ` : '';
    return [`${created} created, ${recreatedCount}${updated} updated, ${restored} restored, ${skipped} skipped, ${failed} failed.`];
  },
  next: (counts, publish) => (deliveredDrafts(counts) ? [next(publish, 'publishes the drafts')] : []),
  failed: 'Failed',
  outcomes: { restored: 'it is back', 'tag-failed': 'the workflow is deployed without it' },
  lockFile: next(`commit ${LOCK_FILE}`, 'it was updated'),
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
    'Dry run: nothing was written.',
    'n8n can still reject a write; this preview covers what reads can show.',
  ],
  next: () => [next('lift deploy', 'applies it')],
  failed: 'Would fail',
  outcomes: { restored: 'deploy would bring it back', 'tag-failed': 'the workflow would be deployed without it' },
  lockFile: next(`commit ${LOCK_FILE} after lift deploy`, 'it would update'),
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

/**
 * Targets on one instance whose folders hold the same stable name: exit 1, nothing was sent. With --json, the error
 * on stdout too.
 */
export function renderSharedEntries(shared: SharedEntry[], format: { json: boolean }): CliResult {
  const title = 'Targets share a workflow on the same instance. Nothing was sent to n8n.';
  const step = `Both would use one entry of ${LOCK_FILE} and overwrite each other. Rename one of the files, or point the targets at different instances in ${CONFIG_FILE}.`;
  const states = shared.map(
    ({ stableName, instance, first, second }) => ({
      stableName,
      state: `targets ${first.target} (${first.path}) and ${second.target} (${second.path}) both deploy it to ${instance}`,
    }),
  );
  const stderr = sections(rows(states.map(({ stableName, state }) => ({ symbol: SYMBOLS.failed, name: stableName, state }))), [title], [next(step)]);
  if (!format.json) {
    return { exitCode: EXIT_USAGE, stdout: '', stderr };
  }
  // The --json message keeps its own layout, so the payload stays as it was.
  const message = [title, ...states.map(({ stableName, state }) => `✗ ${stableName}  ${state}`), `  → ${step}`].join('\n');
  const payload = { error: { kind: 'shared-lock-entry', message }, exitCode: EXIT_USAGE };
  return { exitCode: EXIT_USAGE, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr };
}

/** The run of one target, from what `deliverTargets` returned for it. */
export function renderDelivery(delivery: TargetDelivery, format: DeployFormat): TargetRun {
  const { target } = delivery;
  const where: DeployTarget = { name: target.name, instance: target.connection.url.value };
  switch (delivery.kind) {
  case 'invalid-files':
    return renderInvalidFiles(where, delivery.problems);
  case 'nothing-to-deploy':
    return renderNothingToDeploy(where, target.workflows, format);
  case 'invalid-lock-file':
    return renderInvalidLockFile(where, delivery.error);
  case 'report':
    return renderReport(where, delivery.report, format);
  }
}

/** Workflow files that do not load: exit 1, one line per problem on stderr. */
function renderInvalidFiles(target: DeployTarget, problems: LoadProblem[]): TargetRun {
  const lines = rows(problems.map((problem) => ({ symbol: SYMBOLS.failed, name: problem.path, state: problem.detail })));
  const message = 'Invalid workflow files. Nothing was sent to n8n.';
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_USAGE, stdout: '', stderr: sections(lines, [message]) },
    payload: {
      instance: target.instance,
      error: { kind: 'invalid-files', message, problems: problems.map(({ path, detail }) => ({ path, detail })) },
      exitCode: EXIT_USAGE,
    },
    outcome: 'invalid workflow files, nothing sent',
  };
}

/** A lock file that cannot be read: exit 1, nothing was sent, the problem and the fix on stderr. */
function renderInvalidLockFile(target: DeployTarget, error: LockFileError): TargetRun {
  const message = `Invalid ${LOCK_FILE}. Nothing was sent to n8n.`;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: sections(
        rows([{ symbol: SYMBOLS.failed, name: LOCK_FILE, state: error.detail, followUps: [next('Fix the file, or restore it from version control, then run deploy again.')] }]),
        [message],
      ),
    },
    payload: { instance: target.instance, error: { kind: 'invalid-lock-file', message, detail: error.detail }, exitCode: EXIT_USAGE },
    outcome: `invalid ${LOCK_FILE}, nothing sent`,
  };
}

/** No workflow file under `dir`: exit 0, nothing was sent. */
function renderNothingToDeploy(target: DeployTarget, dir: string, format: DeployFormat): TargetRun {
  const report: DeployReport = { results: [], warnings: [], lockFile: { path: LOCK_FILE, changed: false }, exitCode: EXIT_OK };
  const message = `Nothing to deploy: no workflow in ${dir}.`;
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_OK, stdout: sections([header(wordingOf(format).command, target.name, target.instance)], [message]), stderr: '' },
    payload: jsonPayload(target, report, wordingOf(format), format),
    outcome: message,
  };
}

/** The report of a deploy or a dry run on one target: its text, its JSON payload and its recap. */
function renderReport(target: DeployTarget, report: DeployReport, format: DeployFormat): TargetRun {
  const wording = wordingOf(format);
  const counts = summarize(report.results);
  const [summary = ''] = wording.summary(counts);
  const drafts = wording.dryRun || !deliveredDrafts(counts) ? '' : `  ${next(publishCommand(target, format))}`;
  const stopped = report.error === undefined ? undefined : `stopped: ${report.error.call} : ${report.error.detail}`;
  const outcome =
    stopped !== undefined && report.results.length === 0 ? stopped : stopped !== undefined ? `${stopped}; ${summary}` : `${summary}${drafts}`;
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

/**
 * The workflow link of a result: every workflow that exists on the instance with a known id. A dry-run create or
 * recreate has no id yet, and a failed or not processed workflow has none.
 */
function linkOf(result: DeployResult, target: DeployTarget): string | null {
  switch (result.action) {
  case 'created':
  case 'recreated':
    return result.id === undefined ? null : workflowLink(target.instance, result.id);
  case 'updated':
  case 'skipped':
  case 'restored':
    return workflowLink(target.instance, result.id);
  case 'failed':
  case 'not-processed':
    return null;
  }
}

/**
 * The detail after the label of a result: its workflow link in place of its path when it has one, then its note, or
 * nothing. A failure has its cause under its line.
 */
function detailOf(result: DeployResult, target: DeployTarget): string {
  const where = linkOf(result, target) ?? result.path;
  switch (result.action) {
  case 'created':
    return where;
  case 'recreated':
    return `${where} (n8n no longer has the recorded workflow ${result.previousId})`;
  case 'updated':
    return `${where} (draft; published version still running)`;
  case 'restored':
    return `${where} (unpublished draft)`;
  case 'skipped':
    return `unchanged  ${where}`;
  case 'failed':
  case 'not-processed':
    return '';
  }
}

/** One result as a row: its label and detail, then for a failure its cause and the next step under it. */
function resultRow(result: DeployResult, target: DeployTarget, wording: Wording): Row {
  const detail = detailOf(result, target);
  const label = wording.labels[result.action];
  return {
    symbol: SYMBOL_OF[result.action],
    name: result.stableName,
    state: detail === '' ? label : `${label}  ${detail}`,
    followUps: result.action === 'failed' ? [...cause(result.error.call, result.error.detail), next(result.error.hint)] : [],
  };
}

/**
 * One warning as a sentence. `separator` goes between the failed call and its detail: ` : ` in the text, ` → ` in the
 * --json report, which keeps its sentences as they were.
 */
function warningText(item: DeployWarning, wording: Wording, separator = ' : '): string {
  const { stableName } = item;
  const outcome = wording.outcomes[item.kind];
  switch (item.kind) {
  case 'restored':
    return `${stableName}: workflow ${item.id} was archived in n8n; ${outcome} as an unpublished draft`;
  case 'tag-failed':
    return `${stableName}: tag ${item.tag} not added (${item.call}${separator}${item.detail}); ${outcome}`;
  }
}

function renderText(target: DeployTarget, report: DeployReport, wording: Wording, format: DeployFormat): CliResult {
  const top = [header(wording.command, target.name, target.instance)];
  const list = [...rows(report.results.map((result) => resultRow(result, target, wording))), ...report.warnings.map((item) => warning(warningText(item, wording)))];
  const { error } = report;
  if (error !== undefined && report.results.length === 0) {
    const stop = stopped(error.call, error.detail, [...missingLines(target, error), next(error.hint)]);
    return { exitCode: report.exitCode, stdout: sections(top, list), stderr: sections(stop, ['Nothing was written to n8n.']) };
  }
  const counts = summarize(report.results);
  const [summary = '', ...notes] = wording.summary(counts);
  const tag = report.tag !== undefined && report.tag.added > 0 ? [wording.tag(report.tag.name, report.tag.added)] : [];
  const steps = [...wording.next(counts, publishCommand(target, format)), ...(report.lockFile.changed ? [wording.lockFile] : [])];
  return { exitCode: report.exitCode, stdout: sections(top, list, [summary, ...tag, ...notes], steps), stderr: recap(report, wording) };
}

/** Why a credential is missing, as the line under the stop says it. */
function missingReason(target: DeployTarget, credential: UnresolvedCredential): string {
  const file = credentialsFilePath(target.name);
  switch (credential.reason) {
  case 'not-listed':
    return `not in ${file}`;
  case 'gone':
    return `id ${credential.id ?? ''} in ${file}, gone from the instance`;
  case 'type-changed':
    return `id ${credential.id ?? ''} in ${file}, of another type on the instance`;
  }
}

/** One line per missing credential of a `credentials-missing` stop, under the stop: its key, type, reason and workflows. */
function missingLines(target: DeployTarget, error: DeployError): string[] {
  if (error.kind !== 'credentials-missing') {
    return [];
  }
  return error.missing.map(
    (credential) =>
      `${credential.key} (${credential.type ?? 'type unknown'})  ${missingReason(target, credential)}; used by ${credential.workflows.join(', ')}`,
  );
}

/** The `error` of the --json report. A `credentials-missing` stop also lists each missing credential. */
function errorPayload(error: DeployError): Record<string, unknown> {
  const { call, detail, hint } = error;
  if (error.kind !== 'credentials-missing') {
    return { call, detail, hint };
  }
  const missing = error.missing.map(({ key, type, reason, id, workflows }) => ({ key, type: type ?? null, reason, id: id ?? null, workflows }));
  return { kind: error.kind, call, detail, hint, missing };
}

/** The stderr recap: which workflows need attention and what to do next. Empty when everything went through. */
function recap(report: DeployReport, wording: Wording): string {
  const names = (action: DeployAction): string[] =>
    report.results.filter((result) => result.action === action).map((result) => result.stableName);
  const failedNames = names('failed');
  const notProcessed = names('not-processed');
  const lines: string[] = [];
  const steps: string[] = [];
  if (failedNames.length > 0) {
    lines.push(`${wording.failed}: ${failedNames.join(', ')}.`);
  }
  if (report.error !== undefined) {
    lines.push(`Stopped: ${report.error.call} : ${report.error.detail}`);
    if (notProcessed.length > 0) {
      lines.push(`Not processed: ${notProcessed.join(', ')}.`);
    }
    steps.push(next(report.error.hint));
  } else if (failedNames.length > 0) {
    steps.push(next('lift deploy', 'once each failure is fixed with the step under its line'));
  }
  return sections(lines, steps);
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
      url: linkOf(result, target),
      ...(result.action === 'failed' ? { error: result.error } : {}),
    })),
    summary,
    warnings: report.warnings.map((item) => warningText(item, wording, ' → ')),
    lockFile: report.lockFile,
    tag: report.tag ?? null,
    error: error === undefined ? null : errorPayload(error),
    next: !wording.dryRun && deliveredDrafts(summary) ? publishCommand(target, format) : null,
    exitCode: report.exitCode,
  };
}
