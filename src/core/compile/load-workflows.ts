import { LoadProblem, LoadResult, LocalWorkflow, StableName, WorkflowFile, WorkflowNode } from '#src/core/compile/workflow.model';
import { isRecord } from '#src/core/guard/is-record';
import { Result, err, ok } from '#src/core/result/result';

export const STABLE_NAME_PATTERN = /^[a-z0-9-]{1,16}$/;

const EXTENSIONS = ['.workflow.ts', '.json'];

/** True when `value` follows the stable-name rule: 1 to 16 of a-z, 0-9 and -. */
export function isStableName(value: string): value is StableName {
  return STABLE_NAME_PATTERN.test(value);
}

/** True when `path` names a workflow file: a `.workflow.ts` module or a `.json` n8n export. */
export function isWorkflowFilePath(path: string): boolean {
  return EXTENSIONS.some((extension) => path.endsWith(extension));
}

/** The file base name without `.workflow.ts` / `.json`. */
function baseNameOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const extension = EXTENSIONS.find((candidate) => base.endsWith(candidate));
  return extension === undefined ? base : base.slice(0, -extension.length);
}

/**
 * Turns the files found under `./workflows` into local workflows. Pure, no I/O.
 * Any problem (invalid or duplicate stable name, unreadable file, missing field, invalid node, duplicate node
 * name, connection to a node that does not exist) fails the whole load,
 * so nothing is sent while one file is wrong.
 */
export function loadWorkflows(files: WorkflowFile[]): LoadResult {
  const problems: LoadProblem[] = [];
  const workflows: LocalWorkflow[] = [];
  const seen = new Map<StableName, string>();

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const stableName = baseNameOf(file.path);
    if (!isStableName(stableName)) {
      problems.push({
        kind: 'invalid-name',
        path: file.path,
        detail: `stable name "${stableName}" must be 1 to 16 lowercase letters, digits or dashes; rename the file`,
      });
      continue;
    }
    const firstPath = seen.get(stableName);
    if (firstPath !== undefined) {
      problems.push({
        kind: 'duplicate-name',
        path: file.path,
        detail: `stable name "${stableName}" is also used by ${firstPath}; rename one of the two files`,
      });
      continue;
    }
    seen.set(stableName, file.path);
    if ('error' in file) {
      problems.push({ kind: 'unreadable', path: file.path, detail: `cannot be read: ${file.error}` });
      continue;
    }
    const workflow = toWorkflow(stableName, file.path, file.content);
    if (!workflow.ok) {
      problems.push({ kind: 'invalid-shape', path: file.path, detail: workflow.error });
      continue;
    }
    workflows.push(workflow.value);
  }

  if (problems.length > 0) {
    return err(problems);
  }
  return ok(workflows.sort((a, b) => a.stableName.localeCompare(b.stableName)));
}

/** The workflow, or a sentence saying what is missing. */
function toWorkflow(stableName: StableName, path: string, content: unknown): Result<LocalWorkflow, string> {
  if (!isRecord(content)) {
    return err('must hold an n8n workflow export (an object with name, nodes and connections)');
  }
  const name = nonEmptyString(content.name);
  const nodes: unknown[] | undefined = Array.isArray(content.nodes) ? content.nodes : undefined;
  const connections = isRecord(content.connections) ? content.connections : undefined;
  const settings = content.settings === undefined ? {} : isRecord(content.settings) ? content.settings : undefined;
  if (name === undefined || nodes === undefined || connections === undefined || settings === undefined) {
    const missing = [
      name === undefined && 'name (a string)',
      nodes === undefined && 'nodes (an array)',
      connections === undefined && 'connections (an object)',
      settings === undefined && 'settings (an object, when set)',
    ].filter((label) => label !== false);
    return err(`missing or invalid ${missing.join(', ')}`);
  }
  const graph = parseGraph(nodes, connections);
  if (!graph.ok) {
    return err(graph.error.join('; '));
  }
  return ok({ stableName, path, name, nodes: graph.value, connections, settings });
}

/** The nodes, or what is wrong with the nodes and connections, one clause each: node fields, duplicate names, dangling edges. */
function parseGraph(nodes: unknown[], connections: Record<string, unknown>): Result<WorkflowNode[], string[]> {
  const problems: string[] = [];
  const parsed: WorkflowNode[] = [];
  const names = new Set<string>();
  const reported = new Set<string>();

  nodes.forEach((node, index) => {
    const result = parseNode(node, index);
    if (result.node === undefined) {
      problems.push(result.problem);
    } else {
      parsed.push(result.node);
    }
    const { name } = result;
    if (name === undefined) return;
    if (names.has(name)) {
      if (!reported.has(name)) problems.push(`node name "${name}" is used twice`);
      reported.add(name);
    }
    names.add(name);
  });

  for (const [source, outputs] of Object.entries(connections)) {
    if (!names.has(source)) {
      problems.push(`connection from "${source}": no node named "${source}"`);
    }
    for (const target of connectionTargets(outputs)) {
      if (target === undefined) {
        problems.push(`connection from "${source}" must map each output type to lists of { node, type, index }`);
      } else if (!names.has(target)) {
        problems.push(`connection from "${source}" to "${target}": no node named "${target}"`);
      }
    }
  }
  return problems.length > 0 ? err(problems) : ok(parsed);
}

/**
 * One node, or the clause saying what is wrong with it. `name` is set whenever the node has a valid name, even when
 * another field is wrong, so that duplicate names and connections are still checked.
 */
function parseNode(
  node: unknown,
  index: number,
): { node: WorkflowNode; name: string } | { node?: undefined; name: string | undefined; problem: string } {
  if (!isRecord(node)) {
    return { name: undefined, problem: `node at index ${index} must be an object` };
  }
  const name = nonEmptyString(node.name);
  const type = typeof node.type === 'string' ? node.type : undefined;
  const typeVersion = typeof node.typeVersion === 'number' ? node.typeVersion : undefined;
  const position = isPosition(node.position) ? node.position : undefined;
  const parameters = isRecord(node.parameters) ? node.parameters : undefined;
  if (name !== undefined && type !== undefined && typeVersion !== undefined && position !== undefined && parameters !== undefined) {
    return { node: { ...node, name, type, typeVersion, position, parameters }, name };
  }
  const missing = [
    name === undefined && 'name (a non-empty string)',
    type === undefined && 'type (a string)',
    typeVersion === undefined && 'typeVersion (a number)',
    position === undefined && 'position (two numbers)',
    parameters === undefined && 'parameters (an object)',
  ].filter((label) => label !== false);
  const label = name === undefined ? `node at index ${index}` : `node "${name}"`;
  return { name, problem: `${label} has a missing or invalid ${missing.join(', ')}` };
}

/** Every target node name under one source of `connections`; `undefined` once for a malformed entry. */
function connectionTargets(outputs: unknown): (string | undefined)[] {
  if (!isRecord(outputs)) return [undefined];
  const targets: string[] = [];
  for (const lists of Object.values(outputs)) {
    if (!Array.isArray(lists)) return [undefined];
    const outputLists: unknown[] = lists;
    for (const list of outputLists) {
      if (list === null) continue;
      if (!Array.isArray(list)) return [undefined];
      const edges: unknown[] = list;
      for (const edge of edges) {
        if (!isRecord(edge) || typeof edge.node !== 'string') return [undefined];
        targets.push(edge.node);
      }
    }
  }
  return targets;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function isPosition(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const items: unknown[] = value;
  const [x, y] = items;
  return typeof x === 'number' && typeof y === 'number';
}
