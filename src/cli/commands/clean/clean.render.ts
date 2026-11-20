import { CliResult } from '#src/cli/cli.model';
import { TargetRun } from '#src/cli/targets.render';
import { CleanGroups, CleanPlan, CleanReport, CleanResult, RemovedWorkflow } from '#src/core/clean/clean.model';
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

/** How the next steps are written: with `--target <name>` when the command line picked targets (`-t` or `--all`). */
export interface CleanFormat {
  named: boolean;
}

/** One target whose reads went through, with the groups clean found there. */
export interface PlannedTarget {
  target: CleanTarget;
  groups: CleanGroups;
}

/** What the command prints: the run of each target, or a declined confirmation. */
export type CleanOutput = { kind: 'runs'; runs: TargetRun[] } | { kind: 'declined' };

/**
 * Why clean lists the removed workflows without archiving them: `dry-run` (`--dry-run`), or `confirmation-needed` (no
 * terminal, or `--json`, and neither `--yes` nor `--force`: exit 11).
 */
export type ListingStage = 'dry-run' | 'confirmation-needed';

const DECLINED = 'Nothing archived.';

const STATE_LABELS: Record<RemovedWorkflow['state'], string> = {
  'to-archive': 'will be archived',
  'already-archived': `already archived in n8n: its entry will be dropped from ${LOCK_FILE}`,
  'not-found': `not found in n8n: its entry will be dropped from ${LOCK_FILE}`,
};

const MARKS: Record<CleanResult['action'], string> = {
  archived: '-',
  'already-archived': '=',
  'not-found': '?',
  failed: '✗',
};

const LABELS: Record<CleanResult['action'], string> = {
  archived: 'archived',
  'already-archived': 'already archived',
  'not-found': 'not found',
  failed: 'failed',
};

const ACTION_WIDTH = 1 + Math.max(...Object.values(LABELS).map((label) => label.length));
const INDENT = ' '.repeat(2 + ACTION_WIDTH);

/** `command`, with `--target <name>` when the command line named targets. */
function withTarget(command: string, target: CleanTarget, format: CleanFormat): string {
  return format.named ? `${command} --target ${target.name}` : command;
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
    text: { exitCode: plan.exitCode, stdout: '', stderr: `✗ ${error.call} → ${error.detail}\n  → ${ping}\nNothing was archived.\n` },
    payload: { instance: target.instance, error: { kind: error.kind, call: error.call, detail: error.detail, next: ping }, exitCode: plan.exitCode },
    outcome: `stopped: ${error.call} → ${error.detail}`,
  };
}

/** A target whose reads went through, while another target's did not: nothing was archived there either. */
export function renderHeldBack(target: CleanTarget): TargetRun {
  const message = 'Nothing archived: another target has a problem.';
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_OK, stdout: `${header(target)}\n${message}\n`, stderr: '' },
    payload: { instance: target.instance, stage: 'held-back', message, exitCode: EXIT_OK },
    outcome: 'nothing archived, another target has a problem',
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
 * The groups of one target before anything is archived. With no removed workflow: "Nothing to clean", exit 0. Otherwise
 * the stage says why nothing was archived: a dry run (exit 0), or a confirmation clean could not ask for (exit 11, with
 * `lift clean --yes` next).
 */
export function renderListing({ target, groups }: PlannedTarget, stage: ListingStage, format: CleanFormat): TargetRun {
  const { removed } = groups;
  const nothing = removed.length === 0;
  const yes = withTarget('lift clean --yes', target, format);
  const exitCode = nothing || stage === 'dry-run' ? EXIT_OK : EXIT_CONFIRMATION_NEEDED;
  const message = nothing
    ? `Nothing to clean: every workflow ${LOCK_FILE} records still has its file.`
    : stage === 'dry-run'
      ? `Dry run: nothing was archived. ${withTarget('lift clean', target, format)} archives the ${count(removed)}.`
      : `Confirmation needed: nothing was archived. ${yes} archives the ${count(removed)}.`;
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
  const next = stage === 'dry-run' ? withTarget('lift clean', target, format) : yes;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode,
      stdout: `${stdout.join('\n')}\n`,
      stderr: exitCode === EXIT_CONFIRMATION_NEEDED ? `Confirmation needed: nothing was archived.\nNext: ${yes}\n` : '',
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

/** The listing of every target with removed workflows, and the `[y/N]` question, written to stderr before archiving. */
export function renderConfirmation(planned: PlannedTarget[]): string {
  const lines: string[] = [];
  const withRemoved = planned.filter(({ groups }) => groups.removed.length > 0);
  for (const { target, groups } of withRemoved) {
    lines.push(header(target), ...removedLines(groups.removed));
  }
  const removed = withRemoved.flatMap(({ groups }) => groups.removed);
  const where = withRemoved.length > 1 ? ` on ${withRemoved.length} targets` : '';
  lines.push(`Clean ${count(removed)}${where}? They are archived in n8n and dropped from ${LOCK_FILE}. [y/N] `);
  return lines.join('\n');
}

/** The answer was not yes (or stdin closed): exit 0, nothing was archived. */
export function renderDeclined(): CliResult {
  return { exitCode: EXIT_OK, stdout: `${DECLINED}\n`, stderr: '' };
}

/** The command to run next for one result, or null when there is nothing to run. */
function nextCommand(result: CleanResult, target: CleanTarget, format: CleanFormat): string | null {
  switch (result.action) {
  case 'archived':
  case 'already-archived':
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
      return withTarget('lift clean', target, format);
    }
  }
}

/** The step under a failed result, for a person. */
function hintOf(result: CleanResult, target: CleanTarget, format: CleanFormat): string | undefined {
  if (result.action !== 'failed') {
    return undefined;
  }
  const again = withTarget('lift clean', target, format);
  switch (result.error.kind) {
  case 'unreachable':
    return `Check the instance with ${withTarget('lift ping', target, format)}, then run ${again} again`;
  case 'key-rejected':
    return API_KEY_HINT;
  case 'scope-missing':
    return `Give the API key the workflow:delete scope (n8n → Settings → n8n API), then run ${again} again`;
  case 'rejected':
    return `Archive the workflow in the n8n editor, then run ${again}: it drops the entry of an archived workflow`;
  case 'lock-write-failed':
    return `Fix the problem with ${LOCK_FILE}, then run ${again}: it drops the entry of an archived workflow`;
  }
}

function detailOf(result: CleanResult): string {
  switch (result.action) {
  case 'archived':
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

function summarize(results: CleanResult[]): Summary {
  const of = (action: CleanResult['action']): number => results.filter((result) => result.action === action).length;
  return { archived: of('archived'), alreadyArchived: of('already-archived'), notFound: of('not-found'), failed: of('failed') };
}

function summaryLine({ archived, alreadyArchived, notFound, failed }: Summary): string {
  return `${archived} archived, ${alreadyArchived} already archived, ${notFound} not found, ${failed} failed.`;
}

/** What clean did on one target: its text, its JSON payload and its recap. */
export function renderReport({ target, groups }: PlannedTarget, report: CleanReport, format: CleanFormat): TargetRun {
  if (report.results.length === 0) {
    return renderListing({ target, groups }, 'dry-run', format);
  }
  const summary = summarize(report.results);
  const dropped = summary.archived + summary.alreadyArchived + summary.notFound > 0;
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
  const stderr = failed.length === 0 ? '' : `Not cleaned: ${failed.join(', ')}.\nNext: follow the step under each line, then run lift clean again.\n`;
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
