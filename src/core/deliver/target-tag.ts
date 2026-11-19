import { StableName } from '#src/core/compile/workflow.model';
import { describeFailure } from '#src/core/deliver/deploy-failure';
import { DeployReport, DeployResult, DeployWarning } from '#src/core/deliver/deploy.model';
import { ApiAnswer, ApiFailure, N8nClient, N8nTag, WorkflowId } from '#src/core/n8n/n8n.model';
import { Result, ok } from '#src/core/common/result';

/** A delivered workflow that lacks the target tag: its id (none yet in a dry run of a create) and the tags it keeps. */
interface Untagged {
  stableName: StableName;
  id?: WorkflowId;
  keep: N8nTag[];
}

/**
 * The report of a dry run, with how many workflows would receive the target tag `name`. It makes no call. A run that
 * stopped adds the tag to none.
 */
export function previewTargetTag(report: DeployReport, current: ReadonlyMap<StableName, N8nTag[]>, name: string): DeployReport {
  const added = report.error === undefined ? untagged(report.results, current, name).length : 0;
  return { ...report, tag: { name, added } };
}

/**
 * Adds the target tag `name` to every delivered workflow that lacks it, the skipped ones included, keeping its other
 * tags (ADR 0014). The tag is found by name, or created. A workflow that already has it gets no call, and when none
 * lacks it nothing is called at all. A failure becomes a `tag-failed` warning on the workflow: the action, the lock
 * file and the exit code stay as they are. A run that stopped adds the tag to none.
 */
export async function addTargetTag(
  report: DeployReport,
  current: ReadonlyMap<StableName, N8nTag[]>,
  client: N8nClient,
  name: string,
): Promise<DeployReport> {
  const todo = report.error === undefined ? untagged(report.results, current, name) : [];
  if (todo.length === 0) {
    return { ...report, tag: { name, added: 0 } };
  }
  const tag = await findOrCreateTag(client, name);
  if (!tag.ok) {
    const warnings = todo.map((workflow) => tagFailed(workflow, name, tag.error));
    return { ...report, warnings: [...report.warnings, ...warnings], tag: { name, added: 0 } };
  }
  const warnings: DeployWarning[] = [];
  let added = 0;
  for (const workflow of todo) {
    if (workflow.id === undefined) {
      continue;
    }
    const set = await client.updateWorkflowTags(workflow.id, [...workflow.keep.map(({ id }) => id), tag.value.body.id]);
    if (set.ok) {
      added += 1;
    } else {
      warnings.push(tagFailed(workflow, name, set.error));
    }
  }
  return { ...report, warnings: [...report.warnings, ...warnings], tag: { name, added } };
}

/** The delivered workflows whose tags on the instance do not include `name`. A created workflow has no tag yet. */
function untagged(results: DeployResult[], current: ReadonlyMap<StableName, N8nTag[]>, name: string): Untagged[] {
  return results.flatMap((result): Untagged[] => {
    switch (result.action) {
    case 'failed':
    case 'not-processed':
      return [];
    case 'created':
    case 'recreated':
    case 'updated':
    case 'skipped':
    case 'restored': {
      const keep = current.get(result.stableName) ?? [];
      if (keep.some((tag) => tag.name === name)) {
        return [];
      }
      return [{ stableName: result.stableName, ...(result.id === undefined ? {} : { id: result.id }), keep }];
    }
    }
  });
}

/** The tag of the instance named `name`, created when there is none. */
async function findOrCreateTag(client: N8nClient, name: string): Promise<Result<ApiAnswer<N8nTag>, ApiFailure>> {
  const listed = await client.listTags();
  if (!listed.ok) {
    return listed;
  }
  const found = listed.value.body.find((tag) => tag.name === name);
  if (found !== undefined) {
    return ok({ ...listed.value, body: found });
  }
  return client.createTag(name);
}

function tagFailed({ stableName }: Untagged, tag: string, failure: ApiFailure): DeployWarning {
  const { call, detail } = describeFailure(failure);
  return { kind: 'tag-failed', stableName, tag, call, detail };
}
