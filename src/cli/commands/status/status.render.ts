import { CliResult } from '#src/cli/cli.model';
import { Row, SYMBOLS, header, next, rows, sections, stopped } from '#src/cli/output.render';
import { TargetRun } from '#src/cli/targets.render';
import { LoadProblem } from '#src/core/compile/workflow.model';
import { EXIT_USAGE } from '#src/core/common/exit-codes';
import { LOCK_FILE } from '#src/core/lock/lock-file';
import { LockFileError } from '#src/core/lock/lock-file.model';
import { workflowLink } from '#src/core/n8n/n8n-api';
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

const SYMBOL_OF: Record<WorkflowState, Row['symbol']> = {
  missing: SYMBOLS.created,
  archived: SYMBOLS.restored,
  differs: SYMBOLS.updated,
  'draft-pending': SYMBOLS.published,
  'up-to-date': SYMBOLS.unchanged,
  removed: SYMBOLS.removed,
  unmanaged: SYMBOLS.unmanaged,
};

const LABELS: Record<WorkflowState, string> = {
  missing: 'missing on the instance',
  archived: 'archived in n8n — next deploy restores it',
  differs: 'differs from n8n — next deploy overwrites the n8n draft',
  'draft-pending': 'draft not yet published',
  'up-to-date': 'up to date',
  removed: 'removed from the project — lift clean archives it',
  unmanaged: 'not in my project',
};

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
    return withTarget(`lift publish ${status.stableName}`, target, format);
  case 'removed':
    return withTarget('lift clean', target, format);
  case 'up-to-date':
  case 'unmanaged':
    return null;
  }
}

/** Workflow files that do not load: exit 1, one line per problem on stderr. */
export function renderInvalidFiles(target: StatusTarget, problems: LoadProblem[]): TargetRun {
  const message = 'Invalid workflow files. Status cannot compare them.';
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
      stderr: sections(
        rows([{ symbol: SYMBOLS.failed, name: LOCK_FILE, state: error.detail, followUps: [next('Fix the file, or restore it from version control, then run status again.')] }]),
        [message],
      ),
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
    outcome: error === undefined ? summaryLine(summary) : `stopped: ${error.call} : ${error.detail}`,
  };
}

function workflowPayload(status: WorkflowStatus, target: StatusTarget, format: StatusFormat): Record<string, unknown> {
  const next = nextCommand(status, target, format);
  if (status.state === 'unmanaged') {
    return { state: status.state, stableName: null, path: null, name: status.name, id: status.id, url: linkOf(status, target), isArchived: status.isArchived, next };
  }
  if (status.state === 'removed') {
    return { state: status.state, stableName: status.stableName, path: null, name: null, id: status.id, url: null, next };
  }
  return {
    state: status.state,
    stableName: status.stableName,
    path: status.path,
    name: status.name,
    id: status.state === 'missing' ? null : status.id,
    url: linkOf(status, target),
    ...(status.state === 'missing' && status.previousId !== undefined ? { previousId: status.previousId } : {}),
    next,
  };
}

function renderText(target: StatusTarget, report: StatusReport, format: StatusFormat, message: string | undefined): CliResult {
  const top = [header('lift status', target.name, target.instance)];
  const lead = message === undefined ? [] : [message];
  const { error } = report;
  if (error !== undefined) {
    const stop = stopped(error.call, error.detail, [next(withTarget('lift ping', target, format))]);
    return { exitCode: report.exitCode, stdout: sections(top, lead), stderr: sections(stop) };
  }
  const list = rows(
    report.workflows.map((status) => {
      const command = nextCommand(status, target, format);
      return { symbol: SYMBOL_OF[status.state], name: titleOf(status), state: detailOf(status, target), followUps: command === null ? [] : [next(command)] };
    }),
  );
  return { exitCode: report.exitCode, stdout: sections(top, list, [...lead, summaryLine(summarize(report.workflows))]), stderr: '' };
}

/** A project workflow by its stable name; another one by its name in n8n. */
function titleOf(status: WorkflowStatus): string {
  return status.state === 'unmanaged' ? status.name : status.stableName;
}

/**
 * The workflow link of a workflow status reads on the instance. A `missing` one is not there, and a `removed` one is
 * not read, so it may not be there either.
 */
function linkOf(status: WorkflowStatus, target: StatusTarget): string | null {
  switch (status.state) {
  case 'missing':
  case 'removed':
    return null;
  case 'archived':
  case 'differs':
  case 'draft-pending':
  case 'up-to-date':
  case 'unmanaged':
    return workflowLink(target.instance, status.id);
  }
}

function detailOf(status: WorkflowStatus, target: StatusTarget): string {
  const link = linkOf(status, target);
  return link === null ? labelOf(status) : `${labelOf(status)}  ${link}`;
}

function labelOf(status: WorkflowStatus): string {
  switch (status.state) {
  case 'unmanaged':
    return `${LABELS.unmanaged} (${status.id}${status.isArchived ? ', archived' : ''})`;
  case 'missing':
    return status.previousId === undefined
      ? `${LABELS.missing} (${status.path})`
      : `${LABELS.missing} (${status.path}; n8n no longer has the recorded workflow ${status.previousId})`;
  case 'removed':
    return `${LABELS.removed} (${status.id})`;
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
    removed: count('removed'),
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
    `${summary.removed} removed`,
    `${summary.unmanaged} not in my project`,
  ].join(', ') + '.';
}

