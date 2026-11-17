import { DeployError, DeployResult } from '#src/core/deliver/deploy.model';
import { formatList } from '#src/core/deliver/format-list';
import { stableTag } from '#src/core/deliver/stable-tag';
import {
  EXIT_API_KEY_REJECTED,
  EXIT_DRAFTS_UNSUPPORTED,
  EXIT_PARTIAL_FAILURE,
  EXIT_UNREACHABLE,
} from '#src/core/exit/exit-codes';
import { API_KEY_HINT, DRAFT_PARAM, MIN_N8N_VERSION, classifyHttpError } from '#src/core/n8n/n8n-api';
import { ApiFailure, ApiResult } from '#src/core/n8n/n8n.model';

/** Carries a failed call out of a write, so that applyPlan fails only that workflow. */
export class Stop extends Error {
  constructor(readonly deployError: DeployError) {
    super(deployError.detail);
  }
}

export function unwrap<T>(result: ApiResult<T>): T {
  if (result.kind === 'ok') {
    return result.body;
  }
  throw new Stop(describeFailure(result));
}

/** A failure that stops the whole run: anything but a per-workflow failure (exit 5). */
export function isFatal(error: DeployError): boolean {
  return error.exitCode !== EXIT_PARTIAL_FAILURE;
}

export function exitCodeOf(items: { action: DeployResult['action'] }[], fatal: DeployError | undefined): number {
  return fatal?.exitCode ?? (items.some(({ action }) => action === 'failed') ? EXIT_PARTIAL_FAILURE : 0);
}

/** The failure of an instance whose API spec answers an error or lacks DRAFT_PARAM (ADR 0003). */
export function draftsUnsupported(spec: Exclude<ApiResult<string>, { kind: 'unreachable' }>): DeployError {
  const reason = spec.kind === 'http-error' ? `HTTP ${spec.status}` : `the API spec has no ${DRAFT_PARAM}`;
  return {
    call: spec.call,
    detail: `${reason}: n8n ${MIN_N8N_VERSION} or later is required`,
    hint: `Upgrade the instance to n8n ${MIN_N8N_VERSION} or later, then run deploy again`,
    exitCode: EXIT_DRAFTS_UNSUPPORTED,
  };
}

/** The failure of a workflow whose stable tag several live workflows carry, as the list `call` showed them. */
export function duplicateTag(call: string, stableName: string, ids: string[]): DeployError {
  const tag = stableTag(stableName);
  return {
    call,
    detail: `workflows ${formatList(ids)} both carry the tag ${tag}`,
    hint: `Remove the tag ${tag} from one of them in the n8n editor, then run deploy again`,
    exitCode: EXIT_PARTIAL_FAILURE,
  };
}

/** What a failed call means for deploy. Exit 3 or 4 stops the whole run; exit 5 fails only the current workflow. */
export function describeFailure(failure: ApiFailure): DeployError {
  if (failure.kind === 'unreachable') {
    return {
      call: failure.call,
      detail: `unreachable: ${failure.reason}`,
      hint: 'Run n8nlift ping to check N8N_URL and your network, then run deploy again',
      exitCode: EXIT_UNREACHABLE,
    };
  }
  const detail = `HTTP ${failure.status}${failure.message === undefined ? '' : `: ${failure.message}`}`;
  if (classifyHttpError(failure.status) === 'key-rejected') {
    return { call: failure.call, detail, hint: API_KEY_HINT, exitCode: EXIT_API_KEY_REJECTED };
  }
  return {
    call: failure.call,
    detail,
    hint: `Check the workflow file and the n8n instance (n8n ${MIN_N8N_VERSION} or later), then run deploy again`,
    exitCode: EXIT_PARTIAL_FAILURE,
  };
}
