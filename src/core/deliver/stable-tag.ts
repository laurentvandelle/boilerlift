import { isStableName } from '#src/core/compile/load-workflows';
import { StableName } from '#src/core/compile/workflow.model';
import { N8nWorkflowSummary, WorkflowId } from '#src/core/n8n/n8n.model';

const STABLE_TAG_PREFIX = 'n8nlift:';

/** The tag that identifies a workflow on the instance (ADR 0002). Only `stableTag` builds one. */
export type StableTag = `${typeof STABLE_TAG_PREFIX}${StableName}`;

/** The tag that identifies a workflow on the instance (ADR 0002). */
export function stableTag(stableName: StableName): StableTag {
  return `${STABLE_TAG_PREFIX}${stableName}`;
}

/** The instance workflows that carry one stable tag. */
export interface Matches {
  live: WorkflowId[];
  archived: WorkflowId[];
}

/**
 * The ids of the instance workflows, by the stable name of each `n8nlift:` tag they carry. A tag whose suffix breaks
 * the stable-name rule matches no local workflow, so it is left out.
 */
export function indexByStableTag(instanceWorkflows: N8nWorkflowSummary[]): Map<StableName, Matches> {
  const index = new Map<StableName, Matches>();
  for (const workflow of instanceWorkflows) {
    for (const tag of workflow.tags) {
      if (!tag.name.startsWith(STABLE_TAG_PREFIX)) {
        continue;
      }
      const stableName = tag.name.slice(STABLE_TAG_PREFIX.length);
      if (!isStableName(stableName)) {
        continue;
      }
      const matches = index.get(stableName) ?? { live: [], archived: [] };
      (workflow.isArchived ? matches.archived : matches.live).push(workflow.id);
      index.set(stableName, matches);
    }
  }
  return index;
}
