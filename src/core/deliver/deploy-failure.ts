import { DeployError, DeployErrorKind, DeployResult, RunEnd } from '#src/core/deliver/deploy.model';
import {
  EXIT_API_KEY_REJECTED,
  EXIT_DRAFTS_UNSUPPORTED,
  EXIT_LOCK_WRITE_FAILED,
  EXIT_OK,
  EXIT_PARTIAL_FAILURE,
  EXIT_UNREACHABLE,
  FailureExitCode,
} from '#src/core/common/exit-codes';
import { API_KEY_HINT, DRAFT_PARAM, MIN_N8N_VERSION, classifyHttpError } from '#src/core/n8n/n8n-api';
import { ApiFailure } from '#src/core/n8n/n8n.model';

/** What each kind of deploy error does to the run: whether it stops it, and the exit code. The one place that says so. */
const EFFECTS: Record<DeployErrorKind, { stopsRun: boolean; exitCode: FailureExitCode }> = {
  unreachable: { stopsRun: true, exitCode: EXIT_UNREACHABLE },
  'key-rejected': { stopsRun: true, exitCode: EXIT_API_KEY_REJECTED },
  'drafts-unsupported': { stopsRun: true, exitCode: EXIT_DRAFTS_UNSUPPORTED },
  'workflow-failed': { stopsRun: false, exitCode: EXIT_PARTIAL_FAILURE },
  'lock-write-failed': { stopsRun: true, exitCode: EXIT_LOCK_WRITE_FAILED },
};

/** A failure that stops the whole run: anything but a per-workflow failure. */
export function isFatal(error: DeployError): boolean {
  return EFFECTS[error.kind].stopsRun;
}

/** How a run ends: stopped by `fatal` with its exit code, or else exit 5 when an item failed, or 0. */
export function runEnd(items: { action: DeployResult['action'] }[], fatal: DeployError | undefined): RunEnd {
  if (fatal !== undefined) {
    return { error: fatal, exitCode: EFFECTS[fatal.kind].exitCode };
  }
  return { exitCode: items.some(({ action }) => action === 'failed') ? EXIT_PARTIAL_FAILURE : EXIT_OK };
}

/**
 * The failure of an instance whose API spec lacks DRAFT_PARAM, or answers the HTTP error `status` (ADR 0003).
 * `call` reads the spec.
 */
export function draftsUnsupported(call: string, status?: number): DeployError {
  const reason = status === undefined ? `the API spec has no ${DRAFT_PARAM}` : `HTTP ${status}`;
  return {
    kind: 'drafts-unsupported',
    call,
    detail: `${reason}: n8n ${MIN_N8N_VERSION} or later is required`,
    hint: `Upgrade the instance to n8n ${MIN_N8N_VERSION} or later, then run deploy again`,
  };
}

/**
 * What a failed call means for deploy. An unreachable instance, an answer that is not the n8n public API, or a
 * rejected key stops the whole run; any other HTTP error fails only the current workflow.
 */
export function describeFailure(failure: ApiFailure): DeployError {
  switch (failure.kind) {
  case 'unreachable':
    return {
      kind: 'unreachable',
      call: failure.call,
      detail: `unreachable: ${failure.reason}`,
      hint: 'Run lift ping to check the url of the target and your network, then run deploy again',
    };
  case 'invalid-response':
    return {
      kind: 'unreachable',
      call: failure.call,
      detail: `unexpected answer (HTTP ${failure.status}): ${failure.detail}`,
      hint: `Check that the url of the target points to an n8n instance (n8n ${MIN_N8N_VERSION} or later), then run deploy again`,
    };
  case 'http-error': {
    const detail = `HTTP ${failure.status}${failure.message === undefined ? '' : `: ${failure.message}`}`;
    if (classifyHttpError(failure.status) === 'key-rejected') {
      return { kind: 'key-rejected', call: failure.call, detail, hint: API_KEY_HINT };
    }
    return {
      kind: 'workflow-failed',
      call: failure.call,
      detail,
      hint: `Check the workflow file and the n8n instance (n8n ${MIN_N8N_VERSION} or later), then run deploy again`,
    };
  }
  }
}
