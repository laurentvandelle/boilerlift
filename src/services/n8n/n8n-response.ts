// Parsers for the bodies the n8n public API sends. The client reads each body through one of them once, with jsonBody,
// so past the client the types are trusted. A parser returns `undefined` when the body does not have the expected shape.
import { isRecord } from '#src/core/common/is-record';
import { isTagId, isWorkflowId } from '#src/core/n8n/n8n-ids';
import { N8nTag, N8nWorkflow, N8nWorkflowSummary } from '#src/core/n8n/n8n.model';
import { JsonParser } from '#src/services/http/http.model';

/** One page of a list endpoint: `{ data, nextCursor }`. */
export interface Page<T> {
  data: T[];
  nextCursor: string | undefined;
}

export const tagParser: JsonParser<N8nTag> = { expected: 'a tag (id, name)', parse: parseTag };

export const tagsParser: JsonParser<N8nTag[]> = { expected: 'a list of tags', parse: (value) => parseList(value, parseTag) };

export const workflowSummaryParser: JsonParser<N8nWorkflowSummary> = {
  expected: 'a workflow (id, name)',
  parse: parseWorkflowSummary,
};

export const workflowParser: JsonParser<N8nWorkflow> = {
  expected: 'a workflow (id, name, nodes, connections)',
  parse: parseWorkflow,
};

/** The parser of a `{ data, nextCursor }` page whose items `item` reads. */
export function pageParser<T>(item: JsonParser<T>): JsonParser<Page<T>> {
  return {
    expected: `a page of ${item.expected} items ({ data, nextCursor })`,
    parse: (value): Page<T> | undefined => {
      if (!isRecord(value)) {
        return undefined;
      }
      const data = parseList(value.data, item.parse);
      const { nextCursor } = value;
      if (data === undefined || !(nextCursor === undefined || nextCursor === null || typeof nextCursor === 'string')) {
        return undefined;
      }
      return { data, nextCursor: nextCursor ?? undefined };
    },
  };
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

/** A summary, plus the draft content. Omitted `settings` default to `{}`. */
function parseWorkflow(value: unknown): N8nWorkflow | undefined {
  const summary = parseWorkflowSummary(value);
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
