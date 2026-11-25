import { PlannedPublish, PublishPlan, UnknownName } from '#src/core/publish/publish.model';
import { ManagedStatus, StatusReport } from '#src/core/status/status.model';

/**
 * Decides what publish does on one target from the report of `readStatus`. Without names, the plan holds every
 * workflow whose draft is waiting to be published, and every workflow that differs from n8n, to report it. With names,
 * each one must be a deployed workflow of the project: a name that matches no workflow file, no recorded id, or an
 * archived workflow is unknown, and the plan publishes nothing. A stopped report stops the plan.
 */
export function decidePublish(report: StatusReport, names: string[]): PublishPlan {
  if (report.error !== undefined) {
    return { kind: 'stopped', error: report.error, exitCode: report.exitCode };
  }
  const statuses = report.workflows.flatMap((status) => (status.state === 'unmanaged' || status.state === 'removed' ? [] : [status]));
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

/**
 * The plan entry of one workflow. Without names (`pendingOnly`), the drafts waiting to be published, plus the workflows
 * that differ from n8n, reported but never published.
 */
function planned(status: ManagedStatus, pendingOnly: boolean): PlannedPublish[] {
  const { stableName, path, name } = status;
  switch (status.state) {
  case 'draft-pending':
    return [{ stableName, path, name, id: status.id, action: 'to-publish' }];
  case 'up-to-date':
    return pendingOnly ? [] : [{ stableName, path, name, id: status.id, action: 'already-published' }];
  case 'differs':
    return [{ stableName, path, name, id: status.id, action: pendingOnly ? 'differs' : 'refused' }];
  case 'missing':
  case 'archived':
    return [];
  }
}
