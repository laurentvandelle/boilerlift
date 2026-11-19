import { EXIT_OK, EXIT_PARTIAL_FAILURE } from '#src/core/common/exit-codes';
import { MIN_N8N_VERSION, classifyHttpError } from '#src/core/n8n/n8n-api';
import { ApiFailure, N8nClient } from '#src/core/n8n/n8n.model';
import {
  PlanPublishInput,
  PlannedPublish,
  PublishFailure,
  PublishPlan,
  PublishReport,
  PublishResult,
  UnknownName,
} from '#src/core/publish/publish.model';
import { readStatus } from '#src/core/status/status';
import { ManagedStatus } from '#src/core/status/status.model';

/**
 * Works out what publish would do on one target, with the reads of `readStatus` only (the workflows of the project,
 * found by the ids of the lock file, ADR 0009). Without names, the plan holds every workflow whose draft is waiting to
 * be published. With names, each one must be a deployed workflow of the project: a name that matches no workflow
 * file, no recorded id, or an archived workflow is unknown, and the plan publishes nothing.
 */
export async function planPublish({ workflows, client, managed, names }: PlanPublishInput): Promise<PublishPlan> {
  const report = await readStatus({ workflows, client, managed, filter: { managed: true, unmanaged: false, archived: false } });
  if (report.error !== undefined) {
    return { kind: 'stopped', error: report.error, exitCode: report.exitCode };
  }
  const statuses = report.workflows.flatMap((status) => (status.state === 'unmanaged' ? [] : [status]));
  if (names.length === 0) {
    return { kind: 'ready', workflows: statuses.flatMap((status) => planned(status, true)) };
  }
  const unknown: UnknownName[] = [];
  const chosen: PlannedPublish[] = [];
  for (const name of [...new Set(names)].sort((a, b) => a.localeCompare(b))) {
    const status = statuses.find((candidate) => candidate.stableName === name);
    if (status === undefined) {
      unknown.push({ name, reason: 'no-file' });
    } else if (status.state === 'missing') {
      unknown.push({ name, reason: 'not-deployed' });
    } else if (status.state === 'archived') {
      unknown.push({ name, reason: 'archived' });
    } else {
      chosen.push(...planned(status, false));
    }
  }
  return unknown.length > 0 ? { kind: 'unknown-names', unknown } : { kind: 'ready', workflows: chosen };
}

/** The plan entry of one workflow. Without names (`pendingOnly`), only the drafts waiting to be published. */
function planned(status: ManagedStatus, pendingOnly: boolean): PlannedPublish[] {
  const { stableName, path, name } = status;
  switch (status.state) {
  case 'draft-pending':
    return [{ stableName, path, name, id: status.id, action: 'to-publish' }];
  case 'up-to-date':
    return pendingOnly ? [] : [{ stableName, path, name, id: status.id, action: 'already-published' }];
  case 'differs':
    return pendingOnly ? [] : [{ stableName, path, name, id: status.id, action: 'refused' }];
  case 'missing':
  case 'archived':
    return [];
  }
}

/**
 * Publishes every `to-publish` workflow of the plan, in order: its current draft becomes the published version. A
 * failure fails only that workflow; the others are still published. A refused or failed workflow makes the run exit 5.
 */
export async function applyPublish(workflows: PlannedPublish[], client: N8nClient): Promise<PublishReport> {
  const results: PublishResult[] = [];
  for (const { action, ...workflow } of workflows) {
    switch (action) {
    case 'already-published':
    case 'refused':
      results.push({ ...workflow, action });
      break;
    case 'to-publish': {
      const answer = await client.publishWorkflow(workflow.id);
      results.push(answer.ok ? { ...workflow, action: 'published' } : { ...workflow, action: 'failed', error: describeFailure(answer.error) });
      break;
    }
    }
  }
  const failed = results.some((result) => result.action === 'refused' || result.action === 'failed');
  return { results, exitCode: failed ? EXIT_PARTIAL_FAILURE : EXIT_OK };
}

function describeFailure(failure: ApiFailure): PublishFailure {
  switch (failure.kind) {
  case 'unreachable':
    return { kind: 'unreachable', call: failure.call, detail: `unreachable: ${failure.reason}` };
  case 'invalid-response':
    return {
      kind: 'unreachable',
      call: failure.call,
      detail: `unexpected answer (HTTP ${failure.status}): ${failure.detail}, check that the url points to n8n ${MIN_N8N_VERSION} or later`,
    };
  case 'http-error': {
    const detail = `HTTP ${failure.status}${failure.message === undefined ? '' : `: ${failure.message}`}`;
    return { kind: classifyHttpError(failure.status) === 'key-rejected' ? 'key-rejected' : 'rejected', call: failure.call, detail };
  }
  }
}
