// Parsers for the bodies the n8n public API sends. The client reads each body through one of them once, with jsonBody,
// so past the client the types are trusted. A parser returns `undefined` when the body does not have the expected shape.
import { isRecord } from '#src/core/common/is-record';
import { isTagId, isWorkflowId } from '#src/core/n8n/n8n-ids';
import { N8nListedWorkflow, N8nTag, N8nWorkflow, N8nWorkflowSummary, N8nWorkflowVersions } from '#src/core/n8n/n8n.model';
import { JsonParser } from '#src/services/http/http.model';

export const workflowSummaryParser: JsonParser<N8nWorkflowSummary> = {
  expected: 'a workflow (id, name)',
  parse: parseWorkflowSummary,
};

export const workflowParser: JsonParser<N8nWorkflow> = {
  expected: 'a workflow (id, name, nodes, connections)',
  parse: parseWorkflow,
};

/** One page of `GET /api/v1/workflows`: its workflows, and the cursor of the next page, null on the last one. */
export interface WorkflowPage {
  data: N8nListedWorkflow[];
  nextCursor: string | null;
}

export const workflowPageParser: JsonParser<WorkflowPage> = {
  expected: 'a page of workflows (data, nextCursor)',
  parse: parseWorkflowPage,
};

export const tagParser: JsonParser<N8nTag> = {
  expected: 'a tag (id, name)',
  parse: parseTag,
};

export const tagListParser: JsonParser<N8nTag[]> = {
  expected: 'a list of tags (id, name)',
  parse: (value) => parseList(value, parseTag),
};

/** One page of `GET /tags`: its tags, and the cursor of the next page (`null` on the last one). */
export interface TagPage {
  data: N8nTag[];
  nextCursor: string | null;
}

export const tagPageParser: JsonParser<TagPage> = {
  expected: 'a page of tags (data, nextCursor)',
  parse: parseTagPage,
};

/** An omitted `nextCursor` reads as the last page. */
function parseTagPage(value: unknown): TagPage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const data = parseList(value.data, parseTag);
  const nextCursor = value.nextCursor ?? null;
  if (data === undefined || (nextCursor !== null && typeof nextCursor !== 'string')) {
    return undefined;
  }
  return { data, nextCursor: nextCursor === '' ? null : nextCursor };
}

function parseTag(value: unknown): N8nTag | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { id, name } = value;
  return isTagId(id) && typeof name === 'string' ? { id, name } : undefined;
}

/** Omitted `tags` default to `[]` and omitted `isArchived` to false: older instances leave them out. */
function parseWorkflowSummary(value: unknown): N8nWorkflowSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { id, name } = value;
  const tags = value.tags === undefined ? [] : parseList(value.tags, parseTag);
  const isArchived = value.isArchived ?? false;
  if (!isWorkflowId(id) || typeof name !== 'string' || tags === undefined || typeof isArchived !== 'boolean') {
    return undefined;
  }
  return { id, name, tags, isArchived };
}

/** Omitted version ids default to null: older instances leave them out. */
function parseVersions(value: Record<string, unknown>): N8nWorkflowVersions | undefined {
  const versionId = value.versionId ?? null;
  const activeVersionId = value.activeVersionId ?? null;
  if ((versionId !== null && typeof versionId !== 'string') || (activeVersionId !== null && typeof activeVersionId !== 'string')) {
    return undefined;
  }
  return { versionId, activeVersionId };
}

/** A summary and its versions. */
function parseListedWorkflow(value: unknown): N8nListedWorkflow | undefined {
  const summary = parseWorkflowSummary(value);
  const versions = isRecord(value) ? parseVersions(value) : undefined;
  return summary === undefined || versions === undefined ? undefined : { ...summary, ...versions };
}

function parseWorkflowPage(value: unknown): WorkflowPage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const data = parseList(value.data, parseListedWorkflow);
  const nextCursor = value.nextCursor ?? null;
  if (data === undefined || (nextCursor !== null && typeof nextCursor !== 'string')) {
    return undefined;
  }
  return { data, nextCursor: nextCursor === '' ? null : nextCursor };
}

/** A summary and its versions, plus the draft content. Omitted `settings` default to `{}`. */
function parseWorkflow(value: unknown): N8nWorkflow | undefined {
  const summary = parseListedWorkflow(value);
  if (summary === undefined || !isRecord(value)) {
    return undefined;
  }
  const { nodes, connections } = value;
  const settings = value.settings ?? {};
  if (!Array.isArray(nodes) || !isRecord(connections) || !isRecord(settings)) {
    return undefined;
  }
  const list: unknown[] = nodes;
  return { ...summary, nodes: list, connections, settings };
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries: unknown[] = value;
  const items: T[] = [];
  for (const entry of entries) {
    const item = parse(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return items;
}
