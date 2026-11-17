import { N8nWorkflowSummary } from '#src/core/n8n/n8n.model';

const STABLE_TAG_PREFIX = 'n8nlift:';

/** The tag that identifies a workflow on the instance (ADR 0002). */
export function stableTag(stableName: string): string {
  return `${STABLE_TAG_PREFIX}${stableName}`;
}

/** The instance workflows that carry one stable tag. */
export interface Matches {
  live: string[];
  archived: string[];
}

/** The ids of the instance workflows, by the stable name of each `n8nlift:` tag they carry. */
export function indexByStableTag(instanceWorkflows: N8nWorkflowSummary[]): Map<string, Matches> {
  const index = new Map<string, Matches>();
  for (const workflow of instanceWorkflows) {
    for (const tag of workflow.tags) {
      if (!tag.name.startsWith(STABLE_TAG_PREFIX)) {
        continue;
      }
      const stableName = tag.name.slice(STABLE_TAG_PREFIX.length);
      const matches = index.get(stableName) ?? { live: [], archived: [] };
      (workflow.isArchived ? matches.archived : matches.live).push(workflow.id);
      index.set(stableName, matches);
    }
  }
  return index;
}
