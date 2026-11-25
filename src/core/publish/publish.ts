import { MIN_N8N_VERSION, classifyHttpError } from '#src/core/n8n/n8n-api';
import { ApiFailure, N8nClient } from '#src/core/n8n/n8n.model';
import { PlanPublishInput, PlannedPublish, PublishFailure, PublishPlan, PublishReport, PublishResult } from '#src/core/publish/publish.model';
import { decidePublish } from '#src/core/publish/publish.rules';
import { readStatus } from '#src/core/status/status';

/**
 * Works out what publish would do on one target, with the reads of `readStatus` only (the workflows of the project,
 * found by the ids of the lock file, ADR 0009), which resolve its `credential()` markers first. What it publishes is decided by `decidePublish` (`publish.rules.ts`).
 */
export async function planPublish({ workflows, client, managed, names, target, credentials }: PlanPublishInput): Promise<PublishPlan> {
  const filter = { managed: true, unmanaged: false, archived: false };
  const report = await readStatus({ workflows, client, managed, removed: new Map(), filter, target, credentials, command: 'publish' });
  return decidePublish(report, names);
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
    case 'differs':
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
  return { results, outcome: failed ? 'partial' : 'completed' };
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
