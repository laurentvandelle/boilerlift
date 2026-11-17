import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { describeFailure, draftsUnsupported, duplicateTag, exitCodeOf, isFatal } from '#src/core/deliver/deploy-failure';
import { DeployError, DeployInput, DeployPlan, DeployWarning, PlannedStep } from '#src/core/deliver/deploy.model';
import { isSameContent } from '#src/core/deliver/normalize';
import { Matches, indexByStableTag } from '#src/core/deliver/stable-tag';
import { DRAFT_PARAM } from '#src/core/n8n/n8n-api';
import { N8nTag } from '#src/core/n8n/n8n.model';

type Target =
  | { kind: 'create' }
  | { kind: 'update'; id: string }
  | { kind: 'restore'; id: string }
  | { kind: 'duplicate'; ids: string[] };

/**
 * Computes what deploy would do, with reads only: the workflow list, the API spec, one GET per workflow to update,
 * and the tag list when a workflow would be created. It never writes.
 */
export async function planDeploy({ workflows, client }: DeployInput): Promise<DeployPlan> {
  const listed = await client.listWorkflows();
  if (listed.kind !== 'ok') {
    return stopped(describeFailure(listed));
  }
  const spec = await client.readApiSpec();
  if (spec.kind === 'unreachable') {
    return stopped(describeFailure(spec));
  }
  if (spec.kind === 'http-error' || !spec.body.includes(DRAFT_PARAM)) {
    return stopped(draftsUnsupported(spec));
  }

  const index = indexByStableTag(listed.body);
  const warnings: DeployWarning[] = [];
  const steps: PlannedStep[] = [];
  let fatal: DeployError | undefined;
  for (const workflow of sortByStableName(workflows)) {
    if (fatal !== undefined) {
      steps.push({ workflow, action: 'not-processed' });
      continue;
    }
    const target = resolveTarget(workflow.stableName, index.get(workflow.stableName), warnings);
    switch (target.kind) {
    case 'duplicate':
      steps.push(failedStep(workflow, duplicateTag(listed.call, workflow.stableName, target.ids)));
      break;
    case 'create':
      steps.push({ workflow, action: 'created' });
      break;
    case 'restore':
      steps.push({ workflow, action: 'restored', id: target.id });
      break;
    case 'update': {
      const draft = await client.getWorkflow(target.id);
      if (draft.kind === 'ok') {
        steps.push({ workflow, action: isSameContent(workflow, draft.body) ? 'skipped' : 'updated', id: target.id });
        break;
      }
      const error = describeFailure(draft);
      steps.push(failedStep(workflow, error, target.id));
      if (isFatal(error)) {
        fatal = error;
      }
    }
    }
  }

  let tags: N8nTag[] | undefined;
  if (fatal === undefined && steps.some(({ action }) => action === 'created')) {
    const listedTags = await client.listTags();
    if (listedTags.kind === 'ok') {
      tags = listedTags.body;
    } else {
      const error = describeFailure(listedTags);
      for (const [i, step] of steps.entries()) {
        if (step.action === 'created') {
          steps[i] = failedStep(step.workflow, error);
        }
      }
      if (isFatal(error)) {
        fatal = error;
      }
    }
  }
  return {
    steps,
    warnings,
    ...(tags === undefined ? {} : { tags }),
    ...(fatal === undefined ? {} : { error: fatal }),
    exitCode: exitCodeOf(steps, fatal),
  };
}

function stopped(error: DeployError): DeployPlan {
  return { steps: [], warnings: [], error, exitCode: error.exitCode };
}

function sortByStableName(workflows: LocalWorkflow[]): LocalWorkflow[] {
  return [...workflows].sort((a, b) => a.stableName.localeCompare(b.stableName));
}

/** Picks what to do with one workflow, and adds a warning when the instance holds archived copies of it. */
function resolveTarget(stableName: string, matches: Matches | undefined, warnings: DeployWarning[]): Target {
  if (matches === undefined) {
    return { kind: 'create' };
  }
  const { live, archived } = matches;
  if (live.length > 1) {
    return { kind: 'duplicate', ids: live };
  }
  const [liveId] = live;
  if (liveId !== undefined) {
    if (archived.length > 0) {
      warnings.push({ kind: 'archived-copies', stableName, archivedIds: archived, liveId });
    }
    return { kind: 'update', id: liveId };
  }
  const [archivedId] = archived;
  if (archivedId === undefined) {
    return { kind: 'create' };
  }
  warnings.push({ kind: 'restored', stableName, id: archivedId });
  if (archived.length > 1) {
    warnings.push({ kind: 'several-archived', stableName, archivedIds: archived, restoredId: archivedId });
  }
  return { kind: 'restore', id: archivedId };
}

function failedStep(workflow: LocalWorkflow, { call, detail, hint }: DeployError, id?: string): PlannedStep {
  return { workflow, action: 'failed', ...(id === undefined ? {} : { id }), error: { call, detail, hint } };
}
