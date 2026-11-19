import { CliResult } from '#src/cli/cli.model';
import { TargetRun } from '#src/cli/targets.render';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { EXIT_USAGE } from '#src/core/common/exit-codes';
import { LOCK_FILE } from '#src/core/deliver/lock-file';
import { LockFileError } from '#src/core/deliver/lock-file.model';
import { StatusReport, WorkflowState, WorkflowStatus } from '#src/core/status/status.model';

/** The target status runs on: its name, its url (the instance the lock file records under) and its workflows folder. */
export interface StatusTarget {
  name: string;
  instance: string;
  folder: string;
}

/** How the next steps are written: with `--target <name>` when the command line picked targets (`-t` or `--all`). */
export interface StatusFormat {
  named: boolean;
  /** The workflows of the project are shown (not `--managed=false`): an empty project then gets its message. */
  managed: boolean;
}

const MARKS: Record<WorkflowState, string> = {
  missing: '+',
  archived: '!',
  differs: '~',
  'draft-pending': '^',
  'up-to-date': '=',
  unmanaged: '·',
};

const LABELS: Record<WorkflowState, string> = {
  missing: 'missing on the instance',
  archived: 'archived in n8n — next deploy restores it',
  differs: 'differs from n8n — next deploy overwrites the n8n draft',
  'draft-pending': 'draft not yet published',
  'up-to-date': 'up to date',
  unmanaged: 'not in my project',
};

/** The next step of a draft not yet published: nothing to run, so `next` is null in JSON. */
const PUBLISH_STEP = 'publish it in the n8n editor';

/** `command`, with `--target <name>` when the command line named targets. */
function withTarget(command: string, target: StatusTarget, format: StatusFormat): string {
  return format.named ? `${command} --target ${target.name}` : command;
}

/** The command to run next for one workflow, or null when there is nothing to run. */
function nextCommand(status: WorkflowStatus, target: StatusTarget, format: StatusFormat): string | null {
  switch (status.state) {
  case 'missing':
  case 'archived':
  case 'differs':
    return withTarget('lift deploy', target, format);
  case 'draft-pending':
  case 'up-to-date':
  case 'unmanaged':
    return null;
  }
}

/** Workflow files that do not load: exit 1, one line per problem on stderr. */
export function renderInvalidFiles(target: StatusTarget, problems: LoadProblem[]): TargetRun {
  const message = 'Invalid workflow files. Status cannot compare them.';
  const lines = problems.map((problem) => `✗ ${problem.path}  ${problem.detail}`);
  return {
    target: target.name,
    url: target.instance,
    text: { exitCode: EXIT_USAGE, stdout: '', stderr: `${message}\n${lines.join('\n')}\n` },
    payload: {
      instance: target.instance,
      error: { kind: 'invalid-files', message, problems: problems.map(({ path, detail }) => ({ path, detail })) },
      exitCode: EXIT_USAGE,
    },
    outcome: 'invalid workflow files',
  };
}

/** A lock file that cannot be read: exit 1, the problem and the fix on stderr. */
export function renderInvalidLockFile(target: StatusTarget, error: LockFileError): TargetRun {
  const message = `Invalid ${LOCK_FILE}. Status cannot tell which workflows are yours.`;
  return {
    target: target.name,
    url: target.instance,
    text: {
      exitCode: EXIT_USAGE,
      stdout: '',
      stderr: `${message}\n✗ ${LOCK_FILE}  ${error.detail}\n  → Fix the file, or restore it from version control, then run status again.\n`,
    },
    payload: { instance: target.instance, error: { kind: 'invalid-lock-file', message, detail: error.detail }, exitCode: EXIT_USAGE },
    outcome: `invalid ${LOCK_FILE}`,
  };
}

/** A `--managed` value that is neither true nor false: exit 1. With --json, the error on stdout too. */
export function renderInvalidManaged(value: string, format: { json: boolean }): CliResult {
  const message = `--managed takes true or false, found "${value}".`;
  if (!format.json) {
    return { exitCode: EXIT_USAGE, stdout: '', stderr: `${message}\n` };
  }
  const payload = { error: { kind: 'invalid-option', message }, exitCode: EXIT_USAGE };
  return { exitCode: EXIT_USAGE, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: `${message}\n` };
}

/** Where every workflow of one target stands: its text, its JSON payload and its recap. `empty`: the project has no workflow file. */
export function renderStatus(target: StatusTarget, report: StatusReport, format: StatusFormat, empty: boolean): TargetRun {
  const message = empty && format.managed ? `No workflow yet in ${target.folder}. Add a workflow file there, then run lift deploy.` : undefined;
  const { error } = report;
  const ping = withTarget('lift ping', target, format);
  const summary = summarize(report.workflows);
  return {
    target: target.name,
    url: target.instance,
    text: renderText(target, report, format, message),
    payload: {
      instance: target.instance,
      message: message ?? null,
      workflows: report.workflows.map((status) => workflowPayload(status, target, format)),
      summary,
      error: error === undefined ? null : { kind: error.kind, call: error.call, detail: error.detail, next: ping },
      exitCode: report.exitCode,
    },
    outcome: error === undefined ? summaryLine(summary) : `stopped: ${error.call} → ${error.detail}`,
  };
}

function workflowPayload(status: WorkflowStatus, target: StatusTarget, format: StatusFormat): Record<string, unknown> {
  const next = nextCommand(status, target, format);
  if (status.state === 'unmanaged') {
    return { state: status.state, stableName: null, path: null, name: status.name, id: status.id, isArchived: status.isArchived, next };
  }
  return {
    state: status.state,
    stableName: status.stableName,
    path: status.path,
    name: status.name,
    id: status.state === 'missing' ? null : status.id,
    ...(status.state === 'missing' && status.previousId !== undefined ? { previousId: status.previousId } : {}),
    next,
  };
}

function renderText(target: StatusTarget, report: StatusReport, format: StatusFormat, message: string | undefined): CliResult {
  const stdout = [`lift status → ${target.name} (${target.instance})`];
  if (message !== undefined) {
    stdout.push(message);
  }
  const { error } = report;
  if (error !== undefined) {
    const stderr = `✗ ${error.call} → ${error.detail}\n  → ${withTarget('lift ping', target, format)}\n`;
    return { exitCode: report.exitCode, stdout: `${stdout.join('\n')}\n`, stderr };
  }
  const titles = report.workflows.map(titleOf);
  const width = Math.max(0, ...titles.map((title) => title.length)) + 2;
  report.workflows.forEach((status, index) => {
    const line = `${MARKS[status.state]} ${(titles[index] ?? '').padEnd(width)}${detailOf(status)}`;
    const next = nextCommand(status, target, format);
    if (status.state === 'draft-pending') {
      // Nothing to run: the step to do by hand ends the state line.
      stdout.push(`${line} → ${PUBLISH_STEP}`);
    } else {
      stdout.push(line, ...(next === null ? [] : [`  → ${next}`]));
    }
  });
  stdout.push(summaryLine(summarize(report.workflows)));
  return { exitCode: report.exitCode, stdout: `${stdout.join('\n')}\n`, stderr: '' };
}

/** A project workflow by its stable name; another one by its name in n8n. */
function titleOf(status: WorkflowStatus): string {
  return status.state === 'unmanaged' ? status.name : status.stableName;
}

function detailOf(status: WorkflowStatus): string {
  switch (status.state) {
  case 'unmanaged':
    return `${LABELS.unmanaged} (${status.id}${status.isArchived ? ', archived' : ''})`;
  case 'missing':
    return status.previousId === undefined
      ? `${LABELS.missing} (${status.path})`
      : `${LABELS.missing} (${status.path}; n8n no longer has the recorded workflow ${status.previousId})`;
  case 'archived':
  case 'differs':
  case 'draft-pending':
  case 'up-to-date':
    return LABELS[status.state];
  }
}

type Summary = Record<WorkflowState, number>;

function summarize(workflows: WorkflowStatus[]): Summary {
  const count = (state: WorkflowState): number => workflows.filter((status) => status.state === state).length;
  return {
    missing: count('missing'),
    archived: count('archived'),
    differs: count('differs'),
    'draft-pending': count('draft-pending'),
    'up-to-date': count('up-to-date'),
    unmanaged: count('unmanaged'),
  };
}

function summaryLine(summary: Summary): string {
  return [
    `${summary.missing} missing`,
    `${summary.archived} archived`,
    `${summary.differs} differ`,
    `${summary['draft-pending']} draft not yet published`,
    `${summary['up-to-date']} up to date`,
    `${summary.unmanaged} not in my project`,
  ].join(', ') + '.';
}

