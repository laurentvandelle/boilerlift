import { CliResult } from '#src/cli/cli.model';
import { TargetRun } from '#src/cli/targets.render';
import { CleanGroups, CleanMode, CleanPlan, CleanReport, CleanResult, CleanWriteCause, RemovedWorkflow } from '#src/core/clean/clean.model';
import { EXIT_CONFIRMATION_NEEDED, EXIT_OK, EXIT_USAGE } from '#src/core/common/exit-codes';
import { LOCK_FILE } from '#src/core/deliver/lock-file';
import { LockFileError } from '#src/core/deliver/lock-file.model';
import { API_KEY_HINT } from '#src/core/n8n/n8n-api';

/** The target clean runs on: its name, its url (the instance the lock file records under) and its workflows folder. */
export interface CleanTarget {
  name: string;
  instance: string;
  folder: string;
}

/**
 * How the output is written: next steps with `--target <name>` when the command line picked targets (`-t` or `--all`),
 * and the wording of `mode`: archive, or delete for good (`--delete`, which every next step to clean again keeps).
 */
export interface CleanFormat {
  named: boolean;
  mode: CleanMode;
}

/** One target whose reads went through, with the groups clean found there. */
export interface PlannedTarget {
  target: CleanTarget;
  groups: CleanGroups;
}

/** What the command prints: the run of each target, or a declined confirmation, in the mode it asked about. */
export type CleanOutput = { kind: 'runs'; runs: TargetRun[] } | { kind: 'declined'; mode: CleanMode };

/**
 * Why clean lists the removed workflows without archiving them: `dry-run` (`--dry-run`), or `confirmation-needed` (no
 * terminal, or `--json`, and neither `--yes` nor `--force`: exit 11).
 */
export type ListingStage = 'dry-run' | 'confirmation-needed';

const DECLINED: Record<CleanMode, string> = { archive: 'Nothing archived.', delete: 'Nothing deleted.' };

/** The past participle of what the mode does, for "nothing was …". */
const DONE: Record<CleanMode, string> = { archive: 'archived', delete: 'deleted' };

const STATE_LABELS: Record<RemovedWorkflow['state'], string> = {
  'to-archive': 'will be archived',
  'to-delete': 'will be deleted for good',
  'already-archived': `already archived in n8n: its entry will be dropped from ${LOCK_FILE}`,
  'not-found': `not found in n8n: its entry will be dropped from ${LOCK_FILE}`,
};

const MARKS: Record<CleanResult['action'], string> = {
  archived: '-',
  'already-archived': '=',
  deleted: '-',
  'not-found': '?',
  failed: '✗',
};

const LABELS: Record<CleanResult['action'], string> = {
  archived: 'archived',
  'already-archived': 'already archived',
  deleted: 'deleted',
  'not-found': 'not found',
  failed: 'failed',
};

const ACTION_WIDTH = 1 + Math.max(...Object.values(LABELS).map((label) => label.length));
const INDENT = ' '.repeat(2 + ACTION_WIDTH);

/** `command`, with `--target <name>` when the command line named targets. */
function withTarget(command: string, target: CleanTarget, format: CleanFormat): string {
  return format.named ? `${command} --target ${target.name}` : command;
}

/** `lift clean`, with `--delete` in delete mode and `--target <name>` when the command line named targets. */
function cleanAgain(target: CleanTarget, format: CleanFormat): string {
  return withTarget(format.mode === 'delete' ? 'lift clean --delete' : 'lift clean', target, format);
}

function header(target: CleanTarget): string {
  return `lift clean → ${target.name} (${target.instance})`;
}

/** A lock file that cannot be read: exit 1, nothing was archived, the problem and the fix on stderr. */
export function renderInvalidLockFile(target: CleanTarget, error: LockFileError): TargetRun {
  const message = `Invalid ${LOCK_FILE}. Nothing was archived.`;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: `${message}\n✗ ${LOCK_FILE}  ${error.detail}\n  → Fix the file, or restore it from version control, then run lift clean again.\n`,
    },
    payload: { instance: target.instance, error: { kind: 'invalid-lock-file', message, detail: error.detail }, exitCode: EXIT_USAGE },
    outcome: `invalid ${LOCK_FILE}, nothing archived`,
  };
}

/** A read that failed: exit 3 or 4, nothing was archived, `lift ping` next. */
export function renderStopped(target: CleanTarget, plan: Extract<CleanPlan, { kind: 'stopped' }>, format: CleanFormat): TargetRun {
  const { error } = plan;
  const ping = withTarget('lift ping', target, format);
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: plan.exitCode, stdout: '', stderr: `✗ ${error.call} → ${error.detail}\n  → ${ping}\nNothing was ${DONE[format.mode]}.\n` },
    payload: { instance: target.instance, error: { kind: error.kind, call: error.call, detail: error.detail, next: ping }, exitCode: plan.exitCode },
    outcome: `stopped: ${error.call} → ${error.detail}`,
  };
}

/** A target whose reads went through, while another target's did not: nothing was archived (or deleted) there either. */
export function renderHeldBack(target: CleanTarget, format: CleanFormat): TargetRun {
  const message = `Nothing ${DONE[format.mode]}: another target has a problem.`;
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_OK, stdout: `${header(target)}\n${message}\n`, stderr: '' },
    payload: { instance: target.instance, stage: 'held-back', message, exitCode: EXIT_OK },
    outcome: `nothing ${DONE[format.mode]}, another target has a problem`,
  };
}

function nameOf(workflow: { id: string; name: string | null }): string {
  return workflow.name === null ? workflow.id : `${workflow.name} (${workflow.id})`;
}

function removedLines(removed: RemovedWorkflow[]): string[] {
  const width = Math.max(0, ...removed.map(({ stableName }) => stableName.length)) + 2;
  return removed.map((workflow) => {
    const name = nameOf({ id: workflow.id, name: workflow.state === 'not-found' ? null : workflow.name });
    return `  - ${workflow.stableName.padEnd(width)}${name}: ${STATE_LABELS[workflow.state]}`;
  });
}

/** The two groups clean never touches: the files not deployed yet, with `lift deploy` next, and the unmanaged workflows. */
function otherGroupLines({ notDeployed, unmanaged }: CleanGroups, target: CleanTarget, format: CleanFormat): string[] {
  const lines: string[] = [];
  if (notDeployed.length > 0) {
    const width = Math.max(...notDeployed.map(({ stableName }) => stableName.length)) + 2;
    lines.push('Not deployed yet:');
    lines.push(...notDeployed.map(({ stableName, path }) => `  + ${stableName.padEnd(width)}${path}`));
    lines.push(`    → ${withTarget('lift deploy', target, format)}`);
  }
  if (unmanaged.length > 0) {
    lines.push('Not in my project (clean never touches them):');
    lines.push(...unmanaged.map((workflow) => `  · ${nameOf(workflow)}`));
  }
  return lines;
}

function otherGroupsPayload({ notDeployed, unmanaged }: CleanGroups, target: CleanTarget, format: CleanFormat): Record<string, unknown> {
  return {
    notDeployed: notDeployed.map(({ stableName, path }) => ({ stableName, path, next: withTarget('lift deploy', target, format) })),
    unmanaged: unmanaged.map(({ id, name }) => ({ id, name, next: null })),
  };
}

function count(removed: RemovedWorkflow[]): string {
  return `${removed.length} removed ${removed.length === 1 ? 'workflow' : 'workflows'}`;
}

/**
 * The groups of one target before anything is archived or deleted. With no removed workflow: "Nothing to clean", exit 0.
 * Otherwise the stage says why nothing was archived: a dry run (exit 0), or a confirmation clean could not ask for
 * (exit 11, with `lift clean --yes` next). In delete mode, both stages have `lift clean --delete --yes` next.
 */
export function renderListing({ target, groups }: PlannedTarget, stage: ListingStage, format: CleanFormat): TargetRun {
  const { removed } = groups;
  const nothing = removed.length === 0;
  const deleting = format.mode === 'delete';
  const yes = withTarget(deleting ? 'lift clean --delete --yes' : 'lift clean --yes', target, format);
  const exitCode = nothing || stage === 'dry-run' ? EXIT_OK : EXIT_CONFIRMATION_NEEDED;
  const done = DONE[format.mode];
  const does = (command: string): string => (deleting ? `${command} deletes the ${count(removed)} for good` : `${command} archives the ${count(removed)}`);
  const message = nothing
    ? `Nothing to clean: every workflow ${LOCK_FILE} records still has its file.`
    : stage === 'dry-run'
      ? `Dry run: nothing was ${done}. ${does(deleting ? yes : withTarget('lift clean', target, format))}.`
      : `Confirmation needed: nothing was ${done}. ${does(yes)}.`;
  const stdout = [header(target)];
  if (nothing) {
    stdout.push(message);
  } else {
    stdout.push('Removed from the project:', ...removedLines(removed));
  }
  stdout.push(...otherGroupLines(groups, target, format));
  if (!nothing) {
    stdout.push(message);
  }
  const next = stage === 'dry-run' && !deleting ? withTarget('lift clean', target, format) : yes;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode,
      stdout: `${stdout.join('\n')}\n`,
      stderr: exitCode === EXIT_CONFIRMATION_NEEDED ? `Confirmation needed: nothing was ${done}.\nNext: ${yes}\n` : '',
    },
    payload: {
      instance: target.instance,
      stage: nothing ? 'nothing-to-clean' : stage,
      message,
      removed: removed.map((workflow) => ({
        stableName: workflow.stableName,
        id: workflow.id,
        name: workflow.state === 'not-found' ? null : workflow.name,
        state: workflow.state,
        next,
      })),
      ...otherGroupsPayload(groups, target, format),
      exitCode,
    },
    outcome: nothing ? 'nothing to clean' : stage === 'dry-run' ? `dry run: ${count(removed)}` : `confirmation needed: ${count(removed)}`,
  };
}

/**
 * The listing of every target with removed workflows, and the `[y/N]` question, written to stderr before archiving or
 * deleting.
 */
export function renderConfirmation(planned: PlannedTarget[], mode: CleanMode): string {
  const lines: string[] = [];
  const withRemoved = planned.filter(({ groups }) => groups.removed.length > 0);
  for (const { target, groups } of withRemoved) {
    lines.push(header(target), ...removedLines(groups.removed));
  }
  const removed = withRemoved.flatMap(({ groups }) => groups.removed);
  const where = withRemoved.length > 1 ? ` on ${withRemoved.length} targets` : '';
  switch (mode) {
  case 'archive':
    lines.push(`Clean ${count(removed)}${where}? They are archived in n8n and dropped from ${LOCK_FILE}. [y/N] `);
    break;
  case 'delete': {
    const n = removed.length;
    lines.push(`Delete ${n === 1 ? 'this 1 workflow' : `these ${n} workflows`} for good? This cannot be undone. [y/N] `);
    break;
  }
  }
  return lines.join('\n');
}

/** The answer was not yes (or stdin closed): exit 0, nothing was archived or deleted. */
export function renderDeclined(mode: CleanMode): CliResult {
  return { exitCode: EXIT_OK, stdout: `${DECLINED[mode]}\n`, stderr: '' };
}

/** The command to run next for one result, or null when there is nothing to run. */
function nextCommand(result: CleanResult, target: CleanTarget, format: CleanFormat): string | null {
  switch (result.action) {
  case 'archived':
  case 'already-archived':
  case 'deleted':
  case 'not-found':
    return null;
  case 'failed':
    switch (result.error.kind) {
    case 'unreachable':
      return withTarget('lift ping', target, format);
    case 'key-rejected':
      return null;
    case 'scope-missing':
    case 'rejected':
    case 'lock-write-failed':
      return cleanAgain(target, format);
    case 'delete-failed':
      return withTarget('lift clean --delete', target, format);
    }
  }
}

/** The step under a failed result, for a person. */
function hintOf(result: CleanResult, target: CleanTarget, format: CleanFormat): string | undefined {
  if (result.action !== 'failed') {
    return undefined;
  }
  const again = cleanAgain(target, format);
  const { error } = result;
  switch (error.kind) {
  case 'lock-write-failed':
    return `Fix the problem with ${LOCK_FILE}, then run ${again}: it drops the entry of an archived workflow`;
  case 'delete-failed':
    return `The workflow stays archived. ${causeHint(error.cause, withTarget('lift clean --delete', target, format), target, format)}`;
  case 'unreachable':
  case 'key-rejected':
  case 'scope-missing':
  case 'rejected':
    return causeHint(error.kind, again, target, format);
  }
}

/** The step for a write n8n refused or missed, with `again` the clean to run once it is fixed. */
function causeHint(cause: CleanWriteCause, again: string, target: CleanTarget, format: CleanFormat): string {
  switch (cause) {
  case 'unreachable':
    return `Check the instance with ${withTarget('lift ping', target, format)}, then run ${again} again`;
  case 'key-rejected':
    return API_KEY_HINT;
  case 'scope-missing':
    return `Give the API key the workflow:delete scope (n8n → Settings → n8n API), then run ${again} again`;
  case 'rejected':
    return format.mode === 'delete'
      ? `Check the workflow in the n8n editor, then run ${again} again`
      : `Archive the workflow in the n8n editor, then run ${again}: it drops the entry of an archived workflow`;
  }
}

function detailOf(result: CleanResult): string {
  switch (result.action) {
  case 'archived':
  case 'deleted':
    return nameOf(result);
  case 'already-archived':
    return `${nameOf(result)}, entry dropped from ${LOCK_FILE}`;
  case 'not-found':
    return `${result.id} is not in n8n, entry dropped from ${LOCK_FILE}`;
  case 'failed':
    return `${result.error.call} → ${result.error.detail}`;
  }
}

type Summary = Record<'archived' | 'alreadyArchived' | 'notFound' | 'failed', number>;

/** In delete mode, the summary gains `deleted`. */
type DeleteSummary = Summary & { deleted: number };

function summarize(results: CleanResult[], mode: CleanMode): Summary | DeleteSummary {
  const of = (action: CleanResult['action']): number => results.filter((result) => result.action === action).length;
  const summary: Summary = { archived: of('archived'), alreadyArchived: of('already-archived'), notFound: of('not-found'), failed: of('failed') };
  return mode === 'delete' ? { ...summary, deleted: of('deleted') } : summary;
}

function summaryLine(summary: Summary | DeleteSummary): string {
  const { notFound, failed } = summary;
  if ('deleted' in summary) {
    return `${summary.deleted} deleted, ${notFound} not found, ${failed} failed.`;
  }
  return `${summary.archived} archived, ${summary.alreadyArchived} already archived, ${notFound} not found, ${failed} failed.`;
}

/** What clean did on one target: its text, its JSON payload and its recap. */
export function renderReport({ target, groups }: PlannedTarget, report: CleanReport, format: CleanFormat): TargetRun {
  if (report.results.length === 0) {
    return renderListing({ target, groups }, 'dry-run', format);
  }
  const summary = summarize(report.results, format.mode);
  const dropped = report.results.some(({ action }) => action !== 'failed');
  const stdout = [header(target)];
  const width = Math.max(...report.results.map(({ stableName }) => stableName.length)) + 2;
  for (const result of report.results) {
    stdout.push(`${MARKS[result.action]} ${LABELS[result.action].padEnd(ACTION_WIDTH)}${result.stableName.padEnd(width)}${detailOf(result)}`);
    const hint = hintOf(result, target, format);
    if (hint !== undefined) {
      stdout.push(`${INDENT}→ ${hint}`);
    }
  }
  stdout.push(summaryLine(summary));
  if (dropped) {
    stdout.push(`${LOCK_FILE} updated — commit it.`);
  }
  stdout.push(...otherGroupLines(groups, target, format));
  const failed = report.results.filter(({ action }) => action === 'failed').map(({ stableName }) => stableName);
  const stderr = failed.length === 0 ? '' : `Not cleaned: ${failed.join(', ')}.\nNext: follow the step under each line, then run ${format.mode === 'delete' ? 'lift clean --delete' : 'lift clean'} again.\n`;
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: report.exitCode, stdout: `${stdout.join('\n')}\n`, stderr },
    payload: {
      instance: target.instance,
      stage: 'cleaned',
      results: report.results.map((result) => ({
        stableName: result.stableName,
        id: result.id,
        name: result.name,
        action: result.action,
        ...(result.action === 'failed' ? { error: result.error } : {}),
        next: nextCommand(result, target, format),
      })),
      ...otherGroupsPayload(groups, target, format),
      summary,
      lockFileUpdated: dropped,
      exitCode: report.exitCode,
    },
    outcome: summaryLine(summary),
  };
}
