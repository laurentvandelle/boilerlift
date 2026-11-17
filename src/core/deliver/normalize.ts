import { LocalWorkflow } from '#src/core/compile/workflow.model';
import { isRecord } from '#src/core/common/is-record';
import { N8nWorkflow } from '#src/core/n8n/n8n.model';

interface Comparable {
  name: string;
  nodes: unknown[];
  connections: unknown;
  settings: Record<string, unknown>;
}

/**
 * The part of a workflow that deploy compares. Node `id` and `webhookId` are dropped, credentials keep
 * only their name per type, nodes are sorted by name, and settings keep only the keys the local file sets,
 * so server defaults (for example `redactionPolicy`) never count as a change.
 */
function comparable(
  workflow: Pick<N8nWorkflow, 'name' | 'nodes' | 'connections' | 'settings'>,
  settingsKeys: string[],
): Comparable {
  const nodes = workflow.nodes.map(normalizeNode);
  nodes.sort((a, b) => nodeName(a).localeCompare(nodeName(b)));
  const { settings } = workflow;
  return {
    name: workflow.name,
    nodes,
    connections: workflow.connections,
    settings: Object.fromEntries(settingsKeys.filter((key) => key in settings).map((key) => [key, settings[key]])),
  };
}

/** True when the instance's current draft already holds the local workflow. */
export function isSameContent(local: LocalWorkflow, draft: N8nWorkflow): boolean {
  const keys = Object.keys(local.settings);
  return stableStringify(comparable(local, keys)) === stableStringify(comparable(draft, keys));
}

function normalizeNode(node: unknown): unknown {
  if (!isRecord(node)) {
    return node;
  }
  const { id: _id, webhookId: _webhookId, credentials, ...rest } = node;
  if (!isRecord(credentials)) {
    return rest;
  }
  const reduced = Object.fromEntries(
    Object.entries(credentials).map(([type, value]) => [type, { name: isRecord(value) ? value.name : undefined }]),
  );
  return { ...rest, credentials: reduced };
}

function nodeName(node: unknown): string {
  const name = isRecord(node) ? node.name : undefined;
  return typeof name === 'string' ? name : '';
}

/** JSON with object keys sorted, so key order never counts as a change. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}
