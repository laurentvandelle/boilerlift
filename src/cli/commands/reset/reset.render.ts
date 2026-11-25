import { CliResult, ConnectedTarget } from '#src/cli/cli.model';
import { Row, SYMBOLS, cause, header, next, rows, sections, stopped } from '#src/cli/output.render';
import { TargetRun } from '#src/cli/targets.render';
import { EXIT_CONFIRMATION_NEEDED, EXIT_OK, EXIT_USAGE } from '#src/cli/exit-codes';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { LockFileError } from '#src/core/lock/lock-file.model';
import { API_KEY_HINT } from '#src/core/n8n/n8n-api';
import { RemovalMode, RemovalReport, RemovalResult, RemovalWriteCause, WorkflowToRemove } from '#src/core/removal/removal.model';
import { KeptEntries, ResetPlan } from '#src/core/reset/reset.model';

/** The target reset runs on: its name, its url (the instance the lock file records under) and its workflows folder. */
export interface ResetTarget {
  name: string;
  instance: string;
  folder: string;
}

/** One target whose reads went through: what reset removes there, and the entries it keeps for the other targets. */
export interface PlannedReset {
  target: ResetTarget;
  plan: Extract<ResetPlan, { kind: 'ready' }>;
}

/** What the command prints: the run of its one target, or a declined confirmation, in the mode it asked about. */
export type ResetOutput = { kind: 'run'; run: TargetRun } | { kind: 'declined'; mode: RemovalMode };

/**
 * Why reset lists the workflows without removing them: `dry-run` (`--dry-run`), or `confirmation-needed` (no terminal,
 * or `--json`, and neither `--yes` nor `--force`: exit 11).
 */
export type ListingStage = 'dry-run' | 'confirmation-needed';

const DECLINED: Record<RemovalMode, string> = { archive: 'Nothing archived.', delete: 'Nothing deleted.' };

/** The past participle of what the mode does, for "nothing was …". */
const DONE: Record<RemovalMode, string> = { archive: 'archived', delete: 'deleted' };

const STATE_LABELS: Record<WorkflowToRemove['state'], string> = {
  'to-archive': 'will be archived',
  'to-delete': 'will be deleted for good',
  'already-archived': `already archived in n8n: its entry will be dropped from ${LOCK_FILE}`,
  'not-found': `not found in n8n: its entry will be dropped from ${LOCK_FILE}`,
};

const STATE_SYMBOLS: Record<WorkflowToRemove['state'], Row['symbol']> = {
  'to-archive': SYMBOLS.removed,
  'to-delete': SYMBOLS.removed,
  'already-archived': SYMBOLS.unchanged,
  'not-found': SYMBOLS.notFound,
};

const SYMBOL_OF: Record<RemovalResult['action'], Row['symbol']> = {
  archived: SYMBOLS.removed,
  'already-archived': SYMBOLS.unchanged,
  deleted: SYMBOLS.removed,
  'not-found': SYMBOLS.notFound,
  failed: SYMBOLS.failed,
};

const LABELS: Record<RemovalResult['action'], string> = {
  archived: 'archived',
  'already-archived': 'already archived',
  deleted: 'deleted',
  'not-found': 'not found',
  failed: 'failed',
};

/** `lift reset --target <name>`, with `--delete` in delete mode and `extra` flags after it. */
function resetCommand(target: ResetTarget, mode: RemovalMode, extra = ''): string {
  return `lift reset --target ${target.name}${mode === 'delete' ? ' --delete' : ''}${extra}`;
}

function heading(target: ResetTarget): string {
  return header('lift reset', target.name, target.instance);
}

/** Where reset runs: the name, instance and folder of `target`. */
export function placeOf(target: ConnectedTarget): ResetTarget {
  return { name: target.name, instance: target.connection.url.value, folder: target.workflows };
}

/** Reset ran without `--target <name>`, or with `--all`: exit 1, nothing was read or removed. */
export function renderTargetNotNamed(format: { json: boolean }): CliResult {
  const message = 'lift reset needs --target <name>, even with a single target declared: it resets one named target, never --all.\n';
  if (!format.json) {
    return { exitCode: EXIT_USAGE, stdout: '', stderr: message };
  }
  const payload = { error: { kind: 'target-not-named', message: message.trimEnd() }, exitCode: EXIT_USAGE };
  return { exitCode: EXIT_USAGE, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: message };
}

/** A lock file that cannot be read: exit 1, nothing was removed, the problem and the fix on stderr. */
export function renderInvalidLockFile(target: ResetTarget, error: LockFileError): TargetRun {
  const message = `Invalid ${LOCK_FILE}. Nothing was removed.`;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: sections(
        rows([{ symbol: SYMBOLS.failed, name: LOCK_FILE, state: error.detail, followUps: [next('Fix the file, or restore it from version control, then run lift reset again.')] }]),
        [message],
      ),
    },
    payload: { instance: target.instance, error: { kind: 'invalid-lock-file', message, detail: error.detail }, exitCode: EXIT_USAGE },
    outcome: `invalid ${LOCK_FILE}, nothing removed`,
  };
}

/** A read that failed: exit 3 or 4, nothing was removed, `lift ping` next. */
export function renderStopped(target: ResetTarget, plan: Extract<ResetPlan, { kind: 'stopped' }>, mode: RemovalMode): TargetRun {
  const { error } = plan;
  const ping = `lift ping --target ${target.name}`;
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: plan.exitCode, stdout: '', stderr: sections(stopped(error.call, error.detail, [next(ping)]), [`Nothing was ${DONE[mode]}.`]) },
    payload: { instance: target.instance, error: { kind: error.kind, call: error.call, detail: error.detail, next: ping }, exitCode: plan.exitCode },
    outcome: `stopped: ${error.call} : ${error.detail}`,
  };
}

function nameOf(workflow: { id: string; name: string | null }): string {
  return workflow.name === null ? workflow.id : `${workflow.name} (${workflow.id})`;
}

function workflowLines(workflows: WorkflowToRemove[]): string[] {
  return rows(
    workflows.map((workflow) => {
      const name = nameOf({ id: workflow.id, name: workflow.state === 'not-found' ? null : workflow.name });
      return { symbol: STATE_SYMBOLS[workflow.state], name: workflow.stableName, state: `${name}: ${STATE_LABELS[workflow.state]}` };
    }),
  );
}

/** One line per other target on the instance: reset never touches its entries. */
function keptLines(kept: KeptEntries[]): string[] {
  return kept.map(({ target, count }) => `${count} workflows of target ${target} kept`);
}

function count(workflows: readonly unknown[]): string {
  return `${workflows.length} ${workflows.length === 1 ? 'workflow' : 'workflows'}`;
}

/**
 * The workflows of the target before anything is removed. With none: "Nothing to remove on <target>.", exit 0.
 * Otherwise the stage says why nothing was removed: a dry run (exit 0), or a confirmation reset could not ask for
 * (exit 11, with `lift reset --target <name> --yes` next).
 */
export function renderListing({ target, plan }: PlannedReset, stage: ListingStage, mode: RemovalMode): TargetRun {
  const { workflows, kept } = plan;
  const nothing = workflows.length === 0;
  const yes = resetCommand(target, mode, ' --yes');
  const exitCode = nothing || stage === 'dry-run' ? EXIT_OK : EXIT_CONFIRMATION_NEEDED;
  const done = DONE[mode];
  const purpose = mode === 'delete' ? `deletes the ${count(workflows)} for good` : `archives the ${count(workflows)}`;
  const command = stage === 'dry-run' ? resetCommand(target, mode) : yes;
  const stageLine = stage === 'dry-run' ? `Dry run: nothing was ${done}.` : `Confirmation needed: nothing was ${done}.`;
  // The --json message keeps its sentence; the text puts the command in the next-step section.
  const message = nothing ? `Nothing to remove on ${target.name}.` : `${stageLine} ${command} ${purpose}.`;
  const list = nothing ? [] : [`Deployed by Boilerlift on ${target.name}:`, ...workflowLines(workflows)];
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode,
      stdout: sections([heading(target)], list, nothing ? [message, ...keptLines(kept)] : [...keptLines(kept), stageLine], nothing ? [] : [next(command, purpose)]),
      stderr: exitCode === EXIT_CONFIRMATION_NEEDED ? sections([`Confirmation needed: nothing was ${done}.`], [next(yes)]) : '',
    },
    payload: {
      instance: target.instance,
      stage: nothing ? 'nothing-to-remove' : stage,
      message,
      workflows: workflows.map((workflow) => ({
        stableName: workflow.stableName,
        id: workflow.id,
        name: workflow.state === 'not-found' ? null : workflow.name,
        state: workflow.state,
        next: command,
      })),
      kept,
      exitCode,
    },
    outcome: nothing ? 'nothing to remove' : stage === 'dry-run' ? `dry run: ${count(workflows)}` : `confirmation needed: ${count(workflows)}`,
  };
}

/** The listing and the typed-name question, written to stderr before archiving or deleting. */
export function renderConfirmation({ target, plan }: PlannedReset, mode: RemovalMode): string {
  const { workflows, kept } = plan;
  const question =
    mode === 'delete'
      ? `Reset ${target.name}? The ${count(workflows)} are deleted for good: this cannot be undone.`
      : `Reset ${target.name}? The ${count(workflows)} are archived in n8n and dropped from ${LOCK_FILE}.`;
  const blocks = [[heading(target)], workflowLines(workflows), keptLines(kept), [question, `Type the target name (${target.name}) to confirm: `]];
  return blocks.filter((block) => block.length > 0).map((block) => block.join('\n')).join('\n\n');
}

/** The typed name was not the target's (or stdin closed): exit 0, nothing was archived or deleted. */
export function renderDeclined(mode: RemovalMode): CliResult {
  return { exitCode: EXIT_OK, stdout: `${DECLINED[mode]}\n`, stderr: '' };
}

/** The command to run next for one result, or null when there is nothing to run. */
function nextCommand(result: RemovalResult, target: ResetTarget, mode: RemovalMode): string | null {
  switch (result.action) {
  case 'archived':
  case 'already-archived':
  case 'deleted':
  case 'not-found':
    return null;
  case 'failed':
    switch (result.error.kind) {
    case 'unreachable':
      return `lift ping --target ${target.name}`;
    case 'key-rejected':
      return null;
    case 'scope-missing':
    case 'rejected':
    case 'lock-write-failed':
      return resetCommand(target, mode);
    case 'delete-failed':
      return resetCommand(target, 'delete');
    }
  }
}

/** The step under a failed result, for a person. */
function hintOf(result: RemovalResult, target: ResetTarget, mode: RemovalMode): string | undefined {
  if (result.action !== 'failed') {
    return undefined;
  }
  const again = resetCommand(target, mode);
  const { error } = result;
  switch (error.kind) {
  case 'lock-write-failed':
    return `Fix the problem with ${LOCK_FILE}, then run ${again}: it drops the entry of an archived workflow`;
  case 'delete-failed':
    return `The workflow stays archived. ${causeHint(error.cause, resetCommand(target, 'delete'), target, mode)}`;
  case 'unreachable':
  case 'key-rejected':
  case 'scope-missing':
  case 'rejected':
    return causeHint(error.kind, again, target, mode);
  }
}

/** The step for a write n8n refused or missed, with `again` the reset to run once it is fixed. */
function causeHint(cause: RemovalWriteCause, again: string, target: ResetTarget, mode: RemovalMode): string {
  switch (cause) {
  case 'unreachable':
    return `Check the instance with lift ping --target ${target.name}, then run ${again} again`;
  case 'key-rejected':
    return API_KEY_HINT;
  case 'scope-missing':
    return `Give the API key the workflow:delete scope (n8n → Settings → n8n API), then run ${again} again`;
  case 'rejected':
    return mode === 'delete'
      ? `Check the workflow in the n8n editor, then run ${again} again`
      : `Archive the workflow in the n8n editor, then run ${again}: it drops the entry of an archived workflow`;
  }
}

function detailOf(result: RemovalResult): string {
  switch (result.action) {
  case 'archived':
  case 'deleted':
    return nameOf(result);
  case 'already-archived':
    return `${nameOf(result)}, entry dropped from ${LOCK_FILE}`;
  case 'not-found':
    return `${result.id} is not in n8n, entry dropped from ${LOCK_FILE}`;
  case 'failed':
    return '';
  }
}

type Summary = Record<'archived' | 'alreadyArchived' | 'notFound' | 'failed', number>;

/** In delete mode, the summary gains `deleted`. */
type DeleteSummary = Summary & { deleted: number };

function summarize(results: RemovalResult[], mode: RemovalMode): Summary | DeleteSummary {
  const of = (action: RemovalResult['action']): number => results.filter((result) => result.action === action).length;
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

/** What reset did on its target: its text, its JSON payload and its recap. */
export function renderReport(planned: PlannedReset, report: RemovalReport, mode: RemovalMode): TargetRun {
  const { target, plan } = planned;
  if (report.results.length === 0) {
    return renderListing(planned, 'dry-run', mode);
  }
  const summary = summarize(report.results, mode);
  const dropped = report.results.some(({ action }) => action !== 'failed');
  const list = rows(
    report.results.map((result) => {
      const hint = hintOf(result, target, mode);
      return {
        symbol: SYMBOL_OF[result.action],
        name: result.stableName,
        state: result.action === 'failed' ? LABELS.failed : `${LABELS[result.action]}  ${detailOf(result)}`,
        followUps: [...(result.action === 'failed' ? cause(result.error.call, result.error.detail) : []), ...(hint === undefined ? [] : [next(hint)])],
      };
    }),
  );
  const stdout = sections(
    [heading(target)],
    list,
    [summaryLine(summary), ...keptLines(plan.kept)],
    dropped ? [next(`commit ${LOCK_FILE}`, 'it was updated')] : [],
  );
  const failed = report.results.filter(({ action }) => action === 'failed').map(({ stableName }) => stableName);
  const stderr =
    failed.length === 0 ? '' : sections([`Not reset: ${failed.join(', ')}.`], [next(resetCommand(target, mode), 'once the step under each line is done')]);
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: report.exitCode, stdout, stderr },
    payload: {
      instance: target.instance,
      stage: 'reset',
      results: report.results.map((result) => ({
        stableName: result.stableName,
        id: result.id,
        name: result.name,
        action: result.action,
        ...(result.action === 'failed' ? { error: result.error } : {}),
        next: nextCommand(result, target, mode),
      })),
      kept: plan.kept,
      summary,
      lockFileUpdated: dropped,
      exitCode: report.exitCode,
    },
    outcome: summaryLine(summary),
  };
}
