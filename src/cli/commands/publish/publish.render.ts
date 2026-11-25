import { CliResult, ConnectedTarget, TargetSelection } from '#src/cli/cli.model';
import { Row, SYMBOLS, cause, header, next, rows, sections, stopped } from '#src/cli/output.render';
import { TargetRun } from '#src/cli/targets.render';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { EXIT_OK, EXIT_USAGE } from '#src/cli/exit-codes';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { LockFileError } from '#src/core/lock/lock-file.model';
import { API_KEY_HINT, workflowLink } from '#src/core/n8n/n8n-api';
import {
  PlannedPublish,
  PublishPlan,
  PublishReport,
  PublishResult,
  ReadyPublish,
  TargetPublishPlan,
  TargetPublished,
  UnknownName,
} from '#src/core/publish/publish.model';

/** The target publish runs on: its name, its url (the instance the lock file records under) and its workflows folder. */
export interface PublishTarget {
  name: string;
  instance: string;
  folder: string;
}

/** How the next steps are written: with `--target <name>` when the command line picked targets (`-t` or `--all`). */
export interface PublishFormat {
  named: boolean;
}

/** What the command prints: the run of each target, or a declined confirmation. */
export type PublishOutput = { kind: 'runs'; runs: TargetRun[] } | { kind: 'declined'; names: string[] };

const DECLINED = 'Nothing published.';

const SYMBOL_OF: Record<PublishResult['action'], Row['symbol']> = {
  published: SYMBOLS.published,
  'already-published': SYMBOLS.unchanged,
  refused: SYMBOLS.failed,
  differs: SYMBOLS.failed,
  failed: SYMBOLS.failed,
};

const LABELS: Record<PublishResult['action'], string> = {
  published: 'published',
  'already-published': 'already published',
  refused: 'not published',
  differs: 'not published',
  failed: 'failed',
};

/** `command`, with `--target <name>` when the command line named targets. */
function withTarget(command: string, target: PublishTarget, format: PublishFormat): string {
  return format.named ? `${command} --target ${target.name}` : command;
}

/** Workflow files that do not load: exit 1, one line per problem on stderr. */
function renderInvalidFiles(target: PublishTarget, problems: LoadProblem[]): TargetRun {
  const message = 'Invalid workflow files. Nothing was published.';
  const lines = rows(problems.map((problem) => ({ symbol: SYMBOLS.failed, name: problem.path, state: problem.detail })));
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_USAGE, stdout: '', stderr: sections(lines, [message]) },
    payload: {
      instance: target.instance,
      error: { kind: 'invalid-files', message, problems: problems.map(({ path, detail }) => ({ path, detail })) },
      exitCode: EXIT_USAGE,
    },
    outcome: 'invalid workflow files, nothing published',
  };
}

/** A lock file that cannot be read: exit 1, nothing was published, the problem and the fix on stderr. */
function renderInvalidLockFile(target: PublishTarget, error: LockFileError): TargetRun {
  const message = `Invalid ${LOCK_FILE}. Nothing was published.`;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: sections(
        rows([{ symbol: SYMBOLS.failed, name: LOCK_FILE, state: error.detail, followUps: [next('Fix the file, or restore it from version control, then run publish again.')] }]),
        [message],
      ),
    },
    payload: { instance: target.instance, error: { kind: 'invalid-lock-file', message, detail: error.detail }, exitCode: EXIT_USAGE },
    outcome: `invalid ${LOCK_FILE}, nothing published`,
  };
}

/** Where publish runs: the name, instance and folder of `target`. */
function placeOf(target: ConnectedTarget): PublishTarget {
  return { name: target.name, instance: target.connection.url.value, folder: target.workflows };
}

/**
 * The run of one target when another target, or this one, is not ready: its problem, or, for a ready target, that
 * nothing was published there either.
 */
export function renderHeldBackPlan(plan: TargetPublishPlan, format: PublishFormat): TargetRun {
  const target = placeOf(plan.target);
  switch (plan.kind) {
  case 'invalid-files':
    return renderInvalidFiles(target, plan.problems);
  case 'invalid-lock-file':
    return renderInvalidLockFile(target, plan.error);
  case 'not-ready':
    return renderNotReady(target, plan.plan, format);
  case 'ready':
    return renderHeldBack(target);
  }
}

/** A plan that is not ready: names that match no deployed workflow (exit 1), or a read that failed (exit 3 or 4). */
function renderNotReady(target: PublishTarget, plan: Exclude<PublishPlan, { kind: 'ready' }>, format: PublishFormat): TargetRun {
  switch (plan.kind) {
  case 'unknown-names':
    return renderUnknownNames(target, plan.unknown, format);
  case 'stopped': {
    const { error } = plan;
    const ping = withTarget('lift ping', target, format);
    return {
      target: target.name,
      url: target.instance,
      text: { exitCode: plan.exitCode, stdout: '', stderr: sections(stopped(error.call, error.detail, [next(ping)]), ['Nothing was published.']) },
      payload: { instance: target.instance, error: { kind: error.kind, call: error.call, detail: error.detail, next: ping }, exitCode: plan.exitCode },
      outcome: `stopped: ${error.call} : ${error.detail}`,
    };
  }
  }
}

function unknownDetail(unknown: UnknownName, target: PublishTarget): string {
  switch (unknown.reason) {
  case 'no-file':
    return `no workflow file with this name in ${target.folder}`;
  case 'not-deployed':
    return `not deployed to this instance: ${LOCK_FILE} records no id for it, or n8n no longer has that id`;
  case 'archived':
    return 'archived in n8n — deploy restores it as a draft';
  }
}

function unknownNext(unknown: UnknownName, target: PublishTarget, format: PublishFormat): string {
  switch (unknown.reason) {
  case 'no-file':
    return withTarget('lift status', target, format);
  case 'not-deployed':
  case 'archived':
    return withTarget('lift deploy', target, format);
  }
}

function renderUnknownNames(target: PublishTarget, unknown: UnknownName[], format: PublishFormat): TargetRun {
  const message = 'Unknown workflow names. Nothing was published.';
  const lines = rows(
    unknown.map((entry) => ({
      symbol: SYMBOLS.failed,
      name: entry.name,
      state: unknownDetail(entry, target),
      followUps: [next(unknownNext(entry, target, format))],
    })),
  );
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_USAGE, stdout: '', stderr: sections(lines, [message]) },
    payload: {
      instance: target.instance,
      error: {
        kind: 'unknown-names',
        message,
        names: unknown.map((entry) => ({
          name: entry.name,
          reason: entry.reason,
          detail: unknownDetail(entry, target),
          next: unknownNext(entry, target, format),
        })),
      },
      exitCode: EXIT_USAGE,
    },
    outcome: `unknown names: ${unknown.map(({ name }) => name).join(', ')}`,
  };
}

/** A target that was ready, while another target was not: nothing was published there either. */
function renderHeldBack(target: PublishTarget): TargetRun {
  const message = 'Nothing published: another target has a problem.';
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_OK, stdout: sections([header('lift publish', target.name, target.instance)], [message]), stderr: '' },
    payload: { instance: target.instance, message, results: [], exitCode: EXIT_OK },
    outcome: 'nothing published, another target has a problem',
  };
}

/** The listing and the `[Y/n]` question, written to stderr before anything is published. */
export function renderConfirmation(ready: readonly ReadyPublish[], format: PublishFormat): string {
  const blocks = ready
    .filter(({ workflows }) => workflows.length > 0)
    .map(({ target: connected, workflows }) => {
      const target = placeOf(connected);
      return [header('lift publish', target.name, target.instance), '', ...rows(workflows.map((workflow) => planRow(workflow, target, format)))];
    });
  const count = ready.reduce((total, { workflows }) => total + workflows.filter(({ action }) => action === 'to-publish').length, 0);
  const targets = ready.filter(({ workflows }) => workflows.some(({ action }) => action === 'to-publish')).length;
  const where = targets > 1 ? ` on ${targets} targets` : '';
  return [...blocks.map((block) => block.join('\n')), `Publish ${count} ${count === 1 ? 'workflow' : 'workflows'}${where}? [Y/n] `].join('\n\n');
}

function planRow(workflow: PlannedPublish, target: PublishTarget, format: PublishFormat): Row {
  const name = workflow.stableName;
  switch (workflow.action) {
  case 'to-publish':
    return { symbol: SYMBOLS.published, name, state: 'draft not yet published, will be published' };
  case 'already-published':
    return { symbol: SYMBOLS.unchanged, name, state: 'already published' };
  case 'refused':
  case 'differs':
    return { symbol: SYMBOLS.failed, name, state: 'differs from n8n, not published', followUps: [next(withTarget('lift deploy', target, format), 'first')] };
  }
}

/**
 * The answer was not yes (or stdin closed): exit 1, nothing was published. With --json, `next` is the same command
 * with `--yes`, which skips the question.
 */
export function renderDeclined(names: string[], selection: TargetSelection, format: { json: boolean }): CliResult {
  if (!format.json) {
    return { exitCode: EXIT_USAGE, stdout: '', stderr: `${DECLINED}\n` };
  }
  const target = selection.kind === 'one' ? ` --target ${selection.name}` : selection.kind === 'all' ? ' --all' : '';
  const next = ['lift publish', ...names].join(' ') + `${target} --yes`;
  const payload = { published: false, message: DECLINED, next, exitCode: EXIT_USAGE };
  return { exitCode: EXIT_USAGE, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: `${DECLINED}\n` };
}

interface Summary {
  published: number;
  alreadyPublished: number;
  refused: number;
  differs: number;
  failed: number;
}

function summarize(results: PublishResult[]): Summary {
  const count = (action: PublishResult['action']): number => results.filter((result) => result.action === action).length;
  return { published: count('published'), alreadyPublished: count('already-published'), refused: count('refused'), differs: count('differs'), failed: count('failed') };
}

/**
 * The last line of a target. Without names, the run never holds an already published workflow, so that count shows
 * only when the command line named workflows, and `to deploy first` (the workflows that differ) only when one does.
 */
function summaryLine({ published, alreadyPublished, refused, differs, failed }: Summary, named: boolean): string {
  if (named) {
    return `${published} published, ${alreadyPublished} already published, ${refused} to deploy first, ${failed} failed.`;
  }
  return `${published} published, ${differs > 0 ? `${differs} to deploy first, ` : ''}${failed} failed.`;
}

/** The command to run next for one result, or null when there is nothing to run. */
function nextCommand(result: PublishResult, target: PublishTarget, format: PublishFormat): string | null {
  switch (result.action) {
  case 'published':
  case 'already-published':
    return null;
  case 'refused':
  case 'differs':
    return withTarget('lift deploy', target, format);
  case 'failed':
    switch (result.error.kind) {
    case 'unreachable':
      return withTarget('lift ping', target, format);
    case 'key-rejected':
      return null;
    case 'rejected':
      return withTarget(`lift publish ${result.stableName}`, target, format);
    }
  }
}

/** The step under a result line, for a person. */
function hintOf(result: PublishResult, target: PublishTarget, format: PublishFormat): string | undefined {
  switch (result.action) {
  case 'published':
  case 'already-published':
    return undefined;
  case 'refused':
  case 'differs':
    return `Run ${withTarget('lift deploy', target, format)} first (it replaces any change made in the n8n editor), then ${withTarget(`lift publish ${result.stableName}`, target, format)}`;
  case 'failed':
    switch (result.error.kind) {
    case 'unreachable':
      return `Check the instance with ${withTarget('lift ping', target, format)}, then run publish again`;
    case 'key-rejected':
      return API_KEY_HINT;
    case 'rejected':
      return `Fix the workflow in the n8n editor, then run ${withTarget(`lift publish ${result.stableName}`, target, format)}`;
    }
  }
}

/** The workflow link of a result: every result but a failure. */
function linkOf(result: PublishResult, target: PublishTarget): string | null {
  return result.action === 'failed' ? null : workflowLink(target.instance, result.id);
}

/** The detail after the label of a result, with its workflow link. A failure has its cause under its line instead. */
function detailOf(result: PublishResult, target: PublishTarget): string {
  const link = workflowLink(target.instance, result.id);
  switch (result.action) {
  case 'published':
    return `${link} (the workflow now runs this version)`;
  case 'already-published':
    return `the published version holds the local file  ${link}`;
  case 'refused':
  case 'differs':
    return `differs from n8n: the local file and the n8n draft differ  ${link}`;
  case 'failed':
    return '';
  }
}

/** One result as a row: its label and detail, then the cause of a failure (every line of it) and the next step. */
function resultRow(result: PublishResult, target: PublishTarget, format: PublishFormat): Row {
  const detail = detailOf(result, target);
  const hint = hintOf(result, target, format);
  const label = LABELS[result.action];
  return {
    symbol: SYMBOL_OF[result.action],
    name: result.stableName,
    state: detail === '' ? label : `${label}  ${detail}`,
    followUps: [...(result.action === 'failed' ? cause(result.error.call, result.error.detail) : []), ...(hint === undefined ? [] : [next(hint)])],
  };
}

/**
 * What publish did on one target: its text, its JSON payload and its recap. `named`: the command line named workflows;
 * without names, a plan with no draft waiting reads "Nothing to publish", above the workflows that differ.
 */
export function renderReport({ target: connected, report }: TargetPublished, format: PublishFormat, named: boolean): TargetRun {
  const target = placeOf(connected);
  const summary = summarize(report.results);
  const nothing = report.results.every(({ action }) => action === 'differs');
  const message = nothing && !named ? 'Nothing to publish: no draft is waiting to be published.' : undefined;
  return {
    target: target.name,
    url: target.instance,
    text: renderText(target, report, format, message, named),
    payload: {
      instance: target.instance,
      message: message ?? null,
      results: report.results.map((result) => ({
        stableName: result.stableName,
        path: result.path,
        name: result.name,
        id: result.id,
        url: linkOf(result, target),
        action: result.action,
        ...(result.action === 'failed' ? { error: result.error } : {}),
        next: nextCommand(result, target, format),
      })),
      summary,
      exitCode: report.exitCode,
    },
    outcome: message ?? summaryLine(summary, named),
  };
}

function renderText(target: PublishTarget, report: PublishReport, format: PublishFormat, message: string | undefined, named: boolean): CliResult {
  const top = [header('lift publish', target.name, target.instance)];
  // A message of several lines (n8n lists the issues of each node) goes under the result, every line at the name column.
  const list = rows(report.results.map((result) => resultRow(result, target, format)));
  const summary = message ?? summaryLine(summarize(report.results), named);
  const notPublished = report.results.filter((result) => result.action === 'refused' || result.action === 'failed').map((result) => result.stableName);
  const stderr =
    notPublished.length === 0 ? '' : sections([`Not published: ${notPublished.join(', ')}.`], [next('lift publish', 'once the step under each line is done')]);
  return { exitCode: report.exitCode, stdout: sections(top, list, [summary]), stderr };
}
